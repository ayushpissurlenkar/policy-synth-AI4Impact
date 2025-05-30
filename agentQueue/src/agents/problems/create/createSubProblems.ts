import { BaseProcessor } from "../../baseProcessor.js";
import { ChatOpenAI } from "langchain/chat_models/openai";
import {
  AIChatMessage,
  BaseChatMessage,
  HumanChatMessage,
  SystemChatMessage,
} from "langchain/schema";

import { IEngineConstants } from "../../../constants.js";
const USE_SHORT_DESCRIPTIONS = true;
export class CreateSubProblemsProcessor extends BaseProcessor {
  async renderRefinePrompt(results: IEngineSubProblem[]) {
    const messages: BaseChatMessage[] = [
      new SystemChatMessage(
        `
            As an AI expert, your role involves the analysis and refinement of problem statements to identify the root causes of the stated problem and output in the form of sub problems.

            Instructions:
            1. Review the sub problems and output a list of refined sub problems frame as root causes.
            2. Output a short title, ${USE_SHORT_DESCRIPTIONS ? "short one" : "two or three"} sentence description and two or three sentence explanation of why the root cause is important.            
            3. Use your extensive knowledge to enrich the details about the root cause but never introduce solutions.
            4. Root causes should describe a hypothesis about why a problem is occurring.
            5. Elaborate on the impact of these root causes, if necessary, to provide better context.
            6. Never provide solutions; your focus should be on outlining the root causes of problems, we'll find the solutions later.
            7. Do not suggest tasks or actions; your task is to explain the problems.
            8. A root cause should not be described as a lack of understanding of the problem.
            9. Do not provide output in markdown format.
            10. Always output in the follwing JSON format: [ { title, description, whyIsSubProblemImportant }  ]
            11. Let's think step by step.`
      ),
      new HumanChatMessage(
        `
           Problem Statement:
           "${this.memory.problemStatement.description}"

           Review and Refine the Following Sub-Problems (in JSON format):
           ${JSON.stringify(results, null, 2)}

           Refined Sub-Problems (in JSON format):
         `
      ),
    ];

    return messages;
  }

  async renderCreatePrompt() {
    //TODO: Human review and improvements of those GPT-4 generated few-shots
    const messages: BaseChatMessage[] = [
      new SystemChatMessage(
        `
            As an AI expert, your role involves the analysis of problem statements to identify the root causes of the stated problem and output in the form of sub problems.

            Instructions:
            1. Output a list of 21 root causes of the stated problem as sub problems.
            2. Output a short title, ${USE_SHORT_DESCRIPTIONS ? "short one" : "two or three"} sentence description and two or three sentence explanation of why the root cause is important.            
            3. Use your extensive knowledge to enrich the details about the root cause but never introduce solutions.
            4. Root causes should describe a hypothesis about why a problem is occurring.
            5. Elaborate on the impact of these root causes, if necessary, to provide better context.
            6. Never provide solutions; your focus should be on outlining the root causes of problems, we'll find the solutions later.
            7. Do not suggest tasks or actions; your task is to explain the problems.
            8. A root cause should not be described as a lack of understanding of the problem.
            9. Do not provide output in markdown format.
            10. Always output in the follwing JSON format: [ { title, description, whyIsSubProblemImportant }  ]
            11. Let's think step by step.
            `
      ),
      new HumanChatMessage(
        `
           Problem Statement:
           "${this.memory.problemStatement.description}"

           Sub-Problems (in JSON format):
         `
      ),
    ];

    return messages;
  }

  async createSubProblems() {
    let results = (await this.callLLM(
      "create-sub-problems",
      IEngineConstants.createSubProblemsModel,
      await this.renderCreatePrompt()
    )) as IEngineSubProblem[];

    if (IEngineConstants.enable.refine.createSubProblems) {
      results = await this.callLLM(
        "create-sub-problems",
        IEngineConstants.createSubProblemsModel,
        await this.renderRefinePrompt(results)
      );
    }

    if (this.memory.subProblems && this.memory.subProblems.length > 0) {
      this.memory.subProblems = [...this.memory.subProblems, ...results];
    } else {
      this.memory.subProblems = results;
    }

    await this.saveMemory();

    this.logger.info("Sub Problems Created")
  }

  async process() {
    this.logger.info("Sub Problems Processor");
    super.process();
    this.chat = new ChatOpenAI({
      temperature: IEngineConstants.createSubProblemsModel.temperature,
      maxTokens: IEngineConstants.createSubProblemsModel.maxOutputTokens,
      modelName: IEngineConstants.createSubProblemsModel.name,
      verbose: IEngineConstants.createSubProblemsModel.verbose,
    });

    await this.createSubProblems();
  }
}
