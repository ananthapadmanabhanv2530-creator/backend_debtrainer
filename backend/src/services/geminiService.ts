import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index';
import { AppError } from '../utils/errors';

const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const ai = new GoogleGenAI(apiKey ? { apiKey } : {});

// Memory tracking for the last working model that succeeded during the active debate session
let lastWorkingModel: string | null = null;

// Essential & Evaluator fallback chain: High to Low power
const ESSENTIAL_MODELS = [
  process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-pro',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
];

// Speech Auto-Correct fallback chain: Low to High power
const SPEECH_MODELS = [
  'gemini-2.0-flash-lite',
  'gemini-2.0-flash',
  'gemini-3.5-flash',
  process.env.GEMINI_MODEL || 'gemini-3.6-flash',
];

interface DebateMessage {
  role: 'user' | 'assistant' | 'system';
  message: string;
}

const LANGUAGE_NAMES: Record<string, string> = {
  'en-US': 'English',
  'en-GB': 'English (UK)',
  'hi-IN': 'Hindi',
  'ta-IN': 'Tamil',
  'ml-IN': 'Malayalam',
  'te-IN': 'Telugu',
  'kn-IN': 'Kannada',
  'bn-IN': 'Bengali',
  'gu-IN': 'Gujarati',
  'mr-IN': 'Marathi',
  'pa-IN': 'Punjabi',
};

const DIFFICULTY_PROMPTS: Record<string, string> = {
  easy: `You are a beginner-level debate opponent. Use simple, straightforward arguments.
Be somewhat agreeable and occasionally acknowledge good points from the user.
Provide gentle hints when the user's arguments could be stronger.
Keep your responses concise (2-3 paragraphs max).`,

  medium: `You are a competent debate opponent at an intermediate level.
Provide solid arguments backed by reasoning and commonly known evidence.
Challenge the user's weaker points while acknowledging strong ones.
Use structured argumentation with clear premises and conclusions.
Keep your responses focused (3-4 paragraphs max).`,

  hard: `You are an advanced debate opponent. Be aggressive in challenging weak arguments.
Use rhetorical techniques, analogies, and logical frameworks.
Press the user for evidence and specifics. Point out logical fallacies by name.
Never concede points easily — always find a counter-angle.
Keep your responses thorough but focused (3-5 paragraphs max).`,

  expert: `You are an expert-level debate opponent — think championship debater.
Use advanced logical frameworks (Toulmin model, Rogerian argumentation).
Expect and demand citations, data, and nuanced reasoning.
Exploit every logical weakness ruthlessly but fairly.
Deploy sophisticated rhetorical strategies: steel-manning before dismantling,
reductio ad absurdum, distinguishing between correlation and causation.
Challenge assumptions at the foundational level.
Keep your responses comprehensive yet precise (4-6 paragraphs max).`,
};

function buildSystemPrompt(
  topic: string,
  aiSide: string,
  difficulty: string,
  language: string = 'en-US'
): string {
  const sideLabel = aiSide === 'support' ? 'SUPPORTING' : 'OPPOSING';
  const difficultyPrompt = DIFFICULTY_PROMPTS[difficulty] || DIFFICULTY_PROMPTS.medium;
  const langName = LANGUAGE_NAMES[language] || 'English';

  const langInstruction = language && language !== 'en-US'
    ? `\n6. MANDATORY LANGUAGE RULE: You MUST conduct the ENTIRE debate, formulate all arguments, state points, and ask follow-up questions strictly in ${langName} (${language}). Do NOT switch or respond in English.`
    : '';

  return `You are an AI debate coach and opponent in a structured debate exercise.

DEBATE TOPIC: "${topic}"
YOUR POSITION: You are ${sideLabel} this topic.

CRITICAL RULES:
1. You MUST maintain your ${sideLabel} position throughout the ENTIRE debate. Never switch sides.
2. You are debating AGAINST the user who holds the opposite position.
3. Stay on topic. Do not deviate from the debate subject.
4. Be respectful but firm in your argumentation.
5. After making your argument, ask a follow-up question to challenge the user's reasoning.${langInstruction}

DIFFICULTY LEVEL:
${difficultyPrompt}

FORMAT:
- Present your arguments clearly in ${langName}
- Challenge the user's points directly
- End each response with a probing question or challenge for the user to respond to
- Do NOT break character or acknowledge you are an AI during the debate`;
}

function extractResetTime(err: any): string {
  if (!err) return ' (Resets daily at 00:00 UTC)';

  const message = err.message || '';
  const detailsStr = JSON.stringify(err?.details || []);

  // Check if daily request/token limit is exhausted across projects
  const isDailyExhausted =
    message.includes('PerDay') ||
    message.includes('GenerateRequestsPerDay') ||
    detailsStr.includes('PerDay') ||
    detailsStr.includes('GenerateRequestsPerDay');

  if (isDailyExhausted) {
    return ' (Daily free limit reached. Resets at 00:00 UTC)';
  }

  const match = message.match(/Please retry in ([\d\.]+)/i);
  if (match && match[1]) {
    const sec = Math.ceil(parseFloat(match[1]));
    if (!isNaN(sec) && sec > 0) {
      return ` (Please retry in ${sec}s)`;
    }
  }

  if (Array.isArray(err.details)) {
    const retryInfo = err.details.find((d: any) => d?.['@type']?.includes('RetryInfo') || d?.retryDelay);
    if (retryInfo?.retryDelay) {
      const sec = Math.ceil(parseFloat(retryInfo.retryDelay));
      if (!isNaN(sec) && sec > 0) {
        return ` (Please retry in ${sec}s)`;
      }
    }
  }

  return ' (Resets daily at 00:00 UTC)';
}

/**
 * Executes a Gemini content generation call with automatic fallback across active model families.
 * Remembers and prioritizes the last successful working model from multi-turn chat.
 * Executes instant fallbacks (<150ms) without blocking server delays and reports accurate retry times.
 */
async function generateWithFallback(
  contents: any,
  configOptions?: any,
  modelsToTry: string[] = ESSENTIAL_MODELS
): Promise<any> {
  let firstError: any = null;
  let lastError: any = null;
  let exhaustedCount = 0;

  // Re-order models to try the last successful working model FIRST
  const orderedModels = lastWorkingModel && modelsToTry.includes(lastWorkingModel)
    ? [lastWorkingModel, ...modelsToTry.filter((m) => m !== lastWorkingModel)]
    : modelsToTry;

  for (const model of orderedModels) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        ...(configOptions ? { config: configOptions } : {}),
      });
      // Store and remember the working model for subsequent evaluation/turns!
      lastWorkingModel = model;
      console.log(`[GeminiService] Content generation successful using model: '${model}'`);
      return response;
    } catch (err: any) {
      const status = err?.status || err?.code || err?.error?.code || 'error';
      const msg = err?.message || '';
      if (!firstError) {
        firstError = err;
      }
      lastError = err;

      console.warn(
        `[GeminiService] Model '${model}' failed (${status} / ${msg.slice(0, 60)}). Trying next fallback model...`
      );

      if (
        status === 429 ||
        status === 404 ||
        status === 503 ||
        status === 'RESOURCE_EXHAUSTED' ||
        status === 'UNAVAILABLE' ||
        msg.includes('RESOURCE_EXHAUSTED') ||
        msg.includes('Quota exceeded') ||
        msg.includes('not found') ||
        msg.includes('high demand')
      ) {
        exhaustedCount++;
      }
    }
  }

  if (exhaustedCount >= modelsToTry.length) {
    const resetTime = extractResetTime(firstError || lastError);
    throw new AppError(
      `Your free tier debate trainer quota is exhausted across all AI models. Please come back after reset${resetTime}!`,
      429
    );
  }

  throw lastError instanceof AppError
    ? lastError
    : new AppError(`AI service error: ${lastError?.message || 'Please try again in a moment.'}`, 500);
}

export const geminiService = {
  // ESSENTIAL: Opening Debate Argument
  startDebate: async (
    topic: string,
    aiSide: string,
    difficulty: string,
    language: string = 'en-US'
  ): Promise<string> => {
    const systemPrompt = buildSystemPrompt(topic, aiSide, difficulty, language);
    const sideLabel = aiSide === 'support' ? 'supporting' : 'opposing';
    const langName = LANGUAGE_NAMES[language] || 'English';

    const prompt = `${systemPrompt}

The debate is about to begin. You are ${sideLabel} the topic: "${topic}".
Deliver your opening argument in ${langName}. Set the stage for the debate by:
1. Stating your position clearly
2. Presenting your strongest opening arguments (2-3 key points)
3. Ending with a challenge or question directed at your opponent

Begin your opening argument now in ${langName}.`;

    const response = await generateWithFallback(prompt, undefined, ESSENTIAL_MODELS);
    return response.text || '';
  },

  // ESSENTIAL: Multi-turn Debate Responses
  continueDebate: async (
    topic: string,
    aiSide: string,
    difficulty: string,
    history: DebateMessage[],
    userMessage: string,
    language: string = 'en-US'
  ): Promise<string> => {
    const systemPrompt = buildSystemPrompt(topic, aiSide, difficulty, language);
    const langName = LANGUAGE_NAMES[language] || 'English';

    let conversationContext = `${systemPrompt}\n\nDEBATE HISTORY:\n`;
    for (const msg of history) {
      const speaker = msg.role === 'user' ? 'OPPONENT' : 'YOU';
      conversationContext += `\n${speaker}: ${msg.message}\n`;
    }

    conversationContext += `\nOPPONENT's latest argument: ${userMessage}

Now respond to your opponent's argument in ${langName}. Remember to:
1. Address their specific points directly
2. Provide counter-arguments or rebuttals
3. Identify any weaknesses in their reasoning
4. Present new evidence or angles
5. End with a probing question or challenge in ${langName}`;

    const response = await generateWithFallback(conversationContext, undefined, ESSENTIAL_MODELS);
    return response.text || '';
  },

  // ESSENTIAL: Debate Hints
  generateHint: async (
    topic: string,
    userSide: string,
    difficulty: string,
    history: DebateMessage[],
    hintType: string,
    language: string = 'en-US'
  ): Promise<string> => {
    const langName = LANGUAGE_NAMES[language] || 'English';
    let transcript = '';
    for (const msg of history) {
      const speaker = msg.role === 'user' ? 'USER' : 'AI_OPPONENT';
      transcript += `${speaker}: ${msg.message}\n\n`;
    }

    const hintPrompts: Record<string, string> = {
      keyword: `Suggest 3-5 powerful keywords or phrases in ${langName} the debater should use in their next argument.`,
      outline: `Provide a brief structured outline (3-4 bullet points) in ${langName} for the debater's next argument.`,
      counterArgument: `Analyze the AI opponent's last argument and provide 2-3 specific counter-arguments in ${langName} the debater could use.`,
      evidence: `Suggest 2-3 specific examples, statistics, or real-world evidence in ${langName} the debater could cite.`,
      socratic: `Provide 2-3 thought-provoking Socratic questions in ${langName} the debater could ask to challenge the opponent.`,
    };

    const hintInstruction = hintPrompts[hintType] || hintPrompts.keyword;

    const prompt = `You are a debate coach providing a hint to a student debater in ${langName}.

DEBATE TOPIC: "${topic}"
STUDENT'S POSITION: ${userSide === 'support' ? 'Supporting' : 'Opposing'}
DIFFICULTY: ${difficulty}
LANGUAGE: ${langName} (${language})

DEBATE SO FAR:
${transcript}

HINT REQUEST TYPE: ${hintType}

${hintInstruction}

RULES:
- Respond strictly in ${langName}
- Be concise and actionable
- Keep the hint under 150 words`;

    const response = await generateWithFallback(prompt, undefined, ESSENTIAL_MODELS);
    return response.text || '';
  },

  // NON-ESSENTIAL: End-of-debate Evaluation
  evaluateDebate: async (
    topic: string,
    userSide: string,
    difficulty: string,
    history: DebateMessage[],
    language: string = 'en-US'
  ): Promise<{
    logicScore: number;
    evidenceScore: number;
    clarityScore: number;
    confidenceScore: number;
    persuasionScore: number;
    overallScore: number;
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
  }> => {
    const langName = LANGUAGE_NAMES[language] || 'English';
    let transcript = '';
    for (const msg of history) {
      const speaker = msg.role === 'user' ? 'USER' : 'AI_OPPONENT';
      transcript += `${speaker}: ${msg.message}\n\n`;
    }

    const prompt = `You are an expert debate judge evaluating a debate conducted in ${langName}.

DEBATE TOPIC: "${topic}"
USER'S POSITION: ${userSide === 'support' ? 'Supporting' : 'Opposing'} the topic
DIFFICULTY LEVEL: ${difficulty}
LANGUAGE: ${langName} (${language})

FULL DEBATE TRANSCRIPT:
${transcript}

Evaluate the USER's performance on the following criteria (0.0 to 10.0 scale).
Provide 3 strengths, 3 weaknesses, and 3 actionable suggestions written in ${langName}.

Respond ONLY with valid JSON in this exact structure:
{
  "logicScore": 8.0,
  "evidenceScore": 7.5,
  "clarityScore": 8.5,
  "confidenceScore": 8.0,
  "persuasionScore": 8.0,
  "overallScore": 8.0,
  "strengths": ["...", "...", "..."],
  "weaknesses": ["...", "...", "..."],
  "suggestions": ["...", "...", "..."]
}`;

    const response = await generateWithFallback(
      prompt,
      { responseMimeType: 'application/json' },
      ESSENTIAL_MODELS
    );

    const responseText = response.text || '{}';

    let cleanedText = responseText.trim();
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    const evaluation = JSON.parse(cleanedText);

    const clamp = (val: any, min: number, max: number): number => {
      const num = parseFloat(val) || 0;
      return Math.min(max, Math.max(min, Math.round(num * 10) / 10));
    };

    return {
      logicScore: clamp(evaluation.logicScore, 0, 10),
      evidenceScore: clamp(evaluation.evidenceScore, 0, 10),
      clarityScore: clamp(evaluation.clarityScore, 0, 10),
      confidenceScore: clamp(evaluation.confidenceScore, 0, 10),
      persuasionScore: clamp(evaluation.persuasionScore, 0, 10),
      overallScore: clamp(evaluation.overallScore, 0, 10),
      strengths: Array.isArray(evaluation.strengths) && evaluation.strengths.length > 0
        ? evaluation.strengths.slice(0, 5)
        : ['Good engagement in the debate session'],
      weaknesses: Array.isArray(evaluation.weaknesses) && evaluation.weaknesses.length > 0
        ? evaluation.weaknesses.slice(0, 5)
        : ['Keep practicing to sharpen your arguments'],
      suggestions: Array.isArray(evaluation.suggestions) && evaluation.suggestions.length > 0
        ? evaluation.suggestions.slice(0, 5)
        : ['Continue practicing across different topics'],
    };
  },

  // NON-ESSENTIAL: Speech Auto-Correct
  correctSpeech: async (
    transcript: string,
    topic?: string,
    language: string = 'en-US'
  ): Promise<string> => {
    const langName = LANGUAGE_NAMES[language] || 'English';
    const prompt = `You are a speech-to-text auto-correct assistant for a debate platform in ${langName}.
Your task is to fix phonetic errors, typos, misheard words, capitalization, and punctuation in the raw voice transcript.

${topic ? `DEBATE TOPIC: "${topic}"` : ''}
LANGUAGE: ${langName} (${language})

RAW SPEECH TRANSCRIPT:
"${transcript}"

RULES:
1. Fix misheard words and speech recognition mistakes in ${langName}.
2. Fix punctuation, sentence structure, and capitalization.
3. DO NOT change the debater's core argument, tone, or key ideas.
4. Output ONLY the corrected text in ${langName}, with no explanations, intro, quotes, or markdown wrappers.`;

    const response = await generateWithFallback(prompt, undefined, SPEECH_MODELS);
    return (response.text || '').trim();
  },
};
