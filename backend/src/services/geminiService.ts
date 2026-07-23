import { GoogleGenAI } from '@google/genai';
import { config } from '../config/index';
import { AppError } from '../utils/errors';

const apiKey = config.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const ai = new GoogleGenAI(apiKey ? { apiKey } : {});

// Model fallback chains (Each model has an independent quota limit in Google Cloud)
const ESSENTIAL_MODELS = [
  process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];
const NON_ESSENTIAL_MODELS = ['gemini-1.5-flash', 'gemini-2.0-flash'];

interface DebateMessage {
  role: 'user' | 'assistant' | 'system';
  message: string;
}

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
  difficulty: string
): string {
  const sideLabel = aiSide === 'support' ? 'SUPPORTING' : 'OPPOSING';
  const difficultyPrompt = DIFFICULTY_PROMPTS[difficulty] || DIFFICULTY_PROMPTS.medium;

  return `You are an AI debate coach and opponent in a structured debate exercise.

DEBATE TOPIC: "${topic}"
YOUR POSITION: You are ${sideLabel} this topic.

CRITICAL RULES:
1. You MUST maintain your ${sideLabel} position throughout the ENTIRE debate. Never switch sides.
2. You are debating AGAINST the user who holds the opposite position.
3. Stay on topic. Do not deviate from the debate subject.
4. Be respectful but firm in your argumentation.
5. After making your argument, ask a follow-up question to challenge the user's reasoning.

DIFFICULTY LEVEL:
${difficultyPrompt}

FORMAT:
- Present your arguments clearly
- Challenge the user's points directly
- End each response with a probing question or challenge for the user to respond to
- Do NOT break character or acknowledge you are an AI during the debate`;
}

function extractResetTime(err: any): string {
  if (!err) return ' (Resets daily at 00:00 UTC / try again shortly)';

  const message = err.message || '';
  const match = message.match(/Please retry in ([\d\.]+[smh]?)/i);
  if (match && match[1]) {
    return ` (Please retry in ${match[1]})`;
  }

  if (Array.isArray(err.details)) {
    const retryInfo = err.details.find((d: any) => d?.['@type']?.includes('RetryInfo') || d?.retryDelay);
    if (retryInfo?.retryDelay) {
      return ` (Please retry in ${retryInfo.retryDelay})`;
    }
  }

  return ' (Resets daily at 00:00 UTC / try again shortly)';
}

/**
 * Executes a Gemini content generation call with automatic fallback across independent model families.
 * Always attempts gemini-3.6-flash first. If quota/rate limit occurs, falls back to 2.5 -> 2.0 -> 1.5.
 */
async function generateWithFallback(
  contents: any,
  configOptions?: any,
  modelsToTry: string[] = ESSENTIAL_MODELS
): Promise<any> {
  let lastError: any = null;
  let exhaustedCount = 0;

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        ...(configOptions ? { config: configOptions } : {}),
      });
      return response;
    } catch (err: any) {
      const status = err?.status || err?.code || 'error';
      console.warn(
        `[GeminiService] Model '${model}' failed (${status}). Trying next fallback model...`
      );
      lastError = err;
      if (
        status === 429 ||
        status === 404 ||
        err?.message?.includes('RESOURCE_EXHAUSTED') ||
        err?.message?.includes('Quota exceeded') ||
        err?.message?.includes('not found')
      ) {
        exhaustedCount++;
      }
    }
  }

  if (exhaustedCount >= modelsToTry.length) {
    const resetTime = extractResetTime(lastError);
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
  // ESSENTIAL: Opening Debate Argument (3.6 -> 2.5 -> 2.0 -> 1.5)
  startDebate: async (
    topic: string,
    aiSide: string,
    difficulty: string
  ): Promise<string> => {
    const systemPrompt = buildSystemPrompt(topic, aiSide, difficulty);
    const sideLabel = aiSide === 'support' ? 'supporting' : 'opposing';

    const prompt = `${systemPrompt}

The debate is about to begin. You are ${sideLabel} the topic: "${topic}".
Deliver your opening argument. Set the stage for the debate by:
1. Stating your position clearly
2. Presenting your strongest opening arguments (2-3 key points)
3. Ending with a challenge or question directed at your opponent

Begin your opening argument now.`;

    const response = await generateWithFallback(prompt, undefined, ESSENTIAL_MODELS);
    return response.text || '';
  },

  // ESSENTIAL: Multi-turn Debate Responses (3.6 -> 2.5 -> 2.0 -> 1.5)
  continueDebate: async (
    topic: string,
    aiSide: string,
    difficulty: string,
    history: DebateMessage[],
    userMessage: string
  ): Promise<string> => {
    const systemPrompt = buildSystemPrompt(topic, aiSide, difficulty);

    let conversationContext = `${systemPrompt}\n\nDEBATE HISTORY:\n`;
    for (const msg of history) {
      const speaker = msg.role === 'user' ? 'OPPONENT' : 'YOU';
      conversationContext += `\n${speaker}: ${msg.message}\n`;
    }

    conversationContext += `\nOPPONENT's latest argument: ${userMessage}

Now respond to your opponent's argument. Remember to:
1. Address their specific points directly
2. Provide counter-arguments or rebuttals
3. Identify any weaknesses in their reasoning
4. Present new evidence or angles
5. End with a probing question or challenge`;

    const response = await generateWithFallback(conversationContext, undefined, ESSENTIAL_MODELS);
    return response.text || '';
  },

  // ESSENTIAL: Debate Hints (3.6 -> 2.5 -> 2.0 -> 1.5)
  generateHint: async (
    topic: string,
    userSide: string,
    difficulty: string,
    history: DebateMessage[],
    hintType: string
  ): Promise<string> => {
    let transcript = '';
    for (const msg of history) {
      const speaker = msg.role === 'user' ? 'USER' : 'AI_OPPONENT';
      transcript += `${speaker}: ${msg.message}\n\n`;
    }

    const hintPrompts: Record<string, string> = {
      keyword: `Suggest 3-5 powerful keywords or phrases the debater should use in their next argument. Focus on impactful terminology, technical terms, and persuasive language relevant to this topic and position.`,
      outline: `Provide a brief structured outline (3-4 bullet points) for the debater's next argument. Include a main claim, supporting points, and a strong concluding statement.`,
      counterArgument: `Analyze the AI opponent's last argument and provide 2-3 specific counter-arguments the debater could use. Focus on logical weaknesses and alternative interpretations.`,
      evidence: `Suggest 2-3 specific examples, statistics, or real-world evidence the debater could cite to strengthen their position. Include brief explanations of why each is relevant.`,
      socratic: `Provide 2-3 thought-provoking Socratic questions the debater could ask to challenge the opponent's reasoning and reveal weaknesses in their argument.`,
    };

    const hintInstruction = hintPrompts[hintType] || hintPrompts.keyword;

    const prompt = `You are a debate coach providing a hint to a student debater.

DEBATE TOPIC: "${topic}"
STUDENT'S POSITION: ${userSide === 'support' ? 'Supporting' : 'Opposing'}
DIFFICULTY: ${difficulty}

DEBATE SO FAR:
${transcript}

HINT REQUEST TYPE: ${hintType}

${hintInstruction}

RULES:
- Be concise and actionable
- Don't write the argument for them — guide them
- Keep the hint under 150 words
- Format clearly with bullet points if needed`;

    const response = await generateWithFallback(prompt, undefined, ESSENTIAL_MODELS);
    return response.text || '';
  },

  // NON-ESSENTIAL: End-of-debate Evaluation
  evaluateDebate: async (
    topic: string,
    userSide: string,
    difficulty: string,
    history: DebateMessage[]
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
    let transcript = '';
    for (const msg of history) {
      const speaker = msg.role === 'user' ? 'USER' : 'AI_OPPONENT';
      transcript += `${speaker}: ${msg.message}\n\n`;
    }

    const prompt = `You are an expert debate judge and coach. Evaluate the USER's debate performance.

DEBATE TOPIC: "${topic}"
USER'S POSITION: ${userSide === 'support' ? 'Supporting' : 'Opposing'} the topic
DIFFICULTY LEVEL: ${difficulty}

FULL DEBATE TRANSCRIPT:
${transcript}

Evaluate the USER's performance (NOT the AI opponent) on the following criteria.
Score each from 0.0 to 10.0 (one decimal place).

SCORING GUIDE:
- Logic (0-10): Quality of reasoning, argument structure, avoiding fallacies
- Evidence (0-10): Use of facts, examples, data, and supporting evidence
- Clarity (0-10): Clear expression, organization of ideas, coherence
- Confidence (0-10): Assertiveness, conviction, handling of opposition
- Persuasion (0-10): Overall persuasive impact, rhetorical effectiveness
- Overall (0-10): Holistic assessment of debate performance

Consider the difficulty level when scoring. At "${difficulty}" level, adjust expectations accordingly.
Provide exactly 3 strengths, 3 weaknesses, and 3 actionable suggestions.`;

    const evaluationJsonSchema = {
      type: 'object',
      properties: {
        logicScore: { type: 'number' },
        evidenceScore: { type: 'number' },
        clarityScore: { type: 'number' },
        confidenceScore: { type: 'number' },
        persuasionScore: { type: 'number' },
        overallScore: { type: 'number' },
        strengths: { type: 'array', items: { type: 'string' } },
        weaknesses: { type: 'array', items: { type: 'string' } },
        suggestions: { type: 'array', items: { type: 'string' } },
      },
      required: [
        'logicScore', 'evidenceScore', 'clarityScore',
        'confidenceScore', 'persuasionScore', 'overallScore',
        'strengths', 'weaknesses', 'suggestions'
      ],
    };

    const response = await generateWithFallback(
      prompt,
      {
        responseMimeType: 'application/json',
        responseSchema: evaluationJsonSchema,
      },
      NON_ESSENTIAL_MODELS
    );

    const responseText = response.text || '{}';

    let cleanedText = responseText.trim();
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    try {
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
        strengths: Array.isArray(evaluation.strengths)
          ? evaluation.strengths.slice(0, 5)
          : ['Good effort'],
        weaknesses: Array.isArray(evaluation.weaknesses)
          ? evaluation.weaknesses.slice(0, 5)
          : ['Keep practicing'],
        suggestions: Array.isArray(evaluation.suggestions)
          ? evaluation.suggestions.slice(0, 5)
          : ['Continue debating to improve'],
      };
    } catch (parseError) {
      console.error('Failed to parse AI evaluation:', parseError, responseText);
      return {
        logicScore: 5.0,
        evidenceScore: 5.0,
        clarityScore: 5.0,
        confidenceScore: 5.0,
        persuasionScore: 5.0,
        overallScore: 5.0,
        strengths: ['Participated in the debate', 'Engaged with the topic', 'Completed the session'],
        weaknesses: ['Evaluation could not be fully parsed', 'Try again for detailed feedback'],
        suggestions: ['Continue practicing to get more detailed evaluations'],
      };
    }
  },

  // NON-ESSENTIAL: Speech Auto-Correct
  correctSpeech: async (
    transcript: string,
    topic?: string
  ): Promise<string> => {
    const prompt = `You are a speech-to-text auto-correct assistant for a debate platform.
Your task is to fix phonetic errors, typos, misheard words, capitalization, and punctuation in the raw voice transcript.

${topic ? `DEBATE TOPIC: "${topic}"` : ''}

RAW SPEECH TRANSCRIPT:
"${transcript}"

RULES:
1. Fix misheard words and speech recognition mistakes (e.g. "for example" instead of "four example", technical debate terminology).
2. Fix punctuation, sentence structure, and capitalization.
3. DO NOT change the debater's core argument, tone, or key ideas.
4. Output ONLY the corrected text, with no explanations, intro, quotes, or markdown wrappers.`;

    const response = await generateWithFallback(prompt, undefined, NON_ESSENTIAL_MODELS);
    return (response.text || '').trim();
  },
};
