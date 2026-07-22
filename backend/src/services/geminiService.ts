import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config/index';

const genAI = new GoogleGenerativeAI(config.geminiApiKey);

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

export const geminiService = {
  startDebate: async (
    topic: string,
    aiSide: string,
    difficulty: string
  ): Promise<string> => {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

    const systemPrompt = buildSystemPrompt(topic, aiSide, difficulty);
    const sideLabel = aiSide === 'support' ? 'supporting' : 'opposing';

    const prompt = `${systemPrompt}

The debate is about to begin. You are ${sideLabel} the topic: "${topic}".
Deliver your opening argument. Set the stage for the debate by:
1. Stating your position clearly
2. Presenting your strongest opening arguments (2-3 key points)
3. Ending with a challenge or question directed at your opponent

Begin your opening argument now.`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    return response.text();
  },

  continueDebate: async (
    topic: string,
    aiSide: string,
    difficulty: string,
    history: DebateMessage[],
    userMessage: string
  ): Promise<string> => {
    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

    const systemPrompt = buildSystemPrompt(topic, aiSide, difficulty);

    // Build conversation context
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

    const result = await model.generateContent(conversationContext);
    const response = result.response;
    return response.text();
  },

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
    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

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

Respond ONLY with valid JSON in this exact format (no markdown, no code blocks):
{
  "logicScore": <number>,
  "evidenceScore": <number>,
  "clarityScore": <number>,
  "confidenceScore": <number>,
  "persuasionScore": <number>,
  "overallScore": <number>,
  "strengths": ["<strength1>", "<strength2>", "<strength3>"],
  "weaknesses": ["<weakness1>", "<weakness2>", "<weakness3>"],
  "suggestions": ["<suggestion1>", "<suggestion2>", "<suggestion3>"]
}

SCORING GUIDE:
- Logic (0-10): Quality of reasoning, argument structure, avoiding fallacies
- Evidence (0-10): Use of facts, examples, data, and supporting evidence
- Clarity (0-10): Clear expression, organization of ideas, coherence
- Confidence (0-10): Assertiveness, conviction, handling of opposition
- Persuasion (0-10): Overall persuasive impact, rhetorical effectiveness
- Overall (0-10): Holistic assessment of debate performance

Consider the difficulty level when scoring. At "${difficulty}" level, adjust expectations accordingly.
Provide exactly 3 strengths, 3 weaknesses, and 3 actionable suggestions.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    // Parse the JSON response, handling potential markdown wrapping
    let cleanedText = responseText.trim();
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    try {
      const evaluation = JSON.parse(cleanedText);

      // Validate and clamp scores
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
};
