import { BaseProcessor } from "../../baseProcessor.js";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { HumanChatMessage, SystemChatMessage } from "langchain/schema";

import { IEngineConstants } from "../../../constants.js";
import { EvidenceWebPageVectorStore } from "../../vectorstore/evidenceWebPage.js";

export class RankWebEvidenceProcessor extends BaseProcessor {
  evidenceWebPageVectorStore = new EvidenceWebPageVectorStore();

  async renderProblemPrompt(
    subProblemIndex: number | null,
    policy: PSPolicy,
    evidenceToRank: string[],
    evidenceType: keyof PSEvidenceRawWebPageData
  ) {
    return [
      new SystemChatMessage(
        `
        You are an expert in filtering and ranking policy evidence.

        1. Filter out irrelevant policy evidence.
        2. Filter out duplicates or near duplicates.
        3. Rank the evidence array by importance to the policy proposal.
        4. Always and only output a JSON String Array: [ policyEvidence ].

        Let's think step by step.`
      ),
      new HumanChatMessage(
        `
        Evidence type: ${evidenceType}

        Policy proposal:
        ${policy.title}
        ${policy.description}

        Policy evidence to filter and rank:
        ${JSON.stringify(evidenceToRank, null, 2)}

        Filtered and ranked policy evidence as a JSON string array:
       `
      ),
    ];
  }

  //TODO: Convert to go through the searchTypes at top like the countEvidence one
  async rankWebEvidence(policy: PSPolicy, subProblemIndex: number) {
    this.logger.info(`Ranking all web evidence for policy ${policy.title}`);

    try {
      for (const evidenceType of IEngineConstants.policyEvidenceFieldTypes) {
        let offset = 0;
        const limit = 100;
        const searchType = IEngineConstants.simplifyEvidenceType(evidenceType);

        while (true) {
          const results =
            await this.evidenceWebPageVectorStore.getWebPagesForProcessing(
              this.memory.groupId,
              subProblemIndex,
              searchType,
              policy.title,
              limit,
              offset
            );

          this.logger.debug(
            `Got ${results.data.Get["EvidenceWebPage"].length} WebPage results from Weaviate`
          );

          if (results.data.Get["EvidenceWebPage"].length === 0) {
            this.logger.info("Exiting");
            break;
          }

          let pageCounter = 0;
          for (const retrievedObject of results.data.Get["EvidenceWebPage"]) {
            const webPage = retrievedObject as PSEvidenceRawWebPageData;
            const id = webPage._additional!.id!;

            const fieldKey = evidenceType as keyof PSEvidenceRawWebPageData;

            if (
              webPage[fieldKey] &&
              Array.isArray(webPage[fieldKey]) &&
              (webPage[fieldKey] as string[]).length > 0
            ) {
              const evidenceToRank = webPage[fieldKey] as string[];

              this.logger.debug(
                `${id} - Evidence before ranking (${evidenceType}):\n${JSON.stringify(evidenceToRank, null, 2)}`
              );

              let rankedEvidence = await this.callLLM(
                "rank-web-evidence",
                IEngineConstants.rankWebEvidenceModel,
                await this.renderProblemPrompt(
                  subProblemIndex,
                  policy,
                  evidenceToRank,
                  fieldKey
                )
              );

              await this.evidenceWebPageVectorStore.updateWebSolutions(
                id,
                fieldKey,
                rankedEvidence,
                true
              );

              this.logger.debug(
                `${id} - Evidence after ranking (${evidenceType}):\n${JSON.stringify(rankedEvidence, null, 2)}`
              );
            } else {
              //this.logger.info(`${id} - No evidence to rank for ${evidenceType}`)
            }

            this.logger.info(
              `${subProblemIndex} - (+${offset + pageCounter++}) - ${id} - Updated`
            );
          }

          offset += limit;
        }
      }
    } catch (error: any) {
      this.logger.error(error.stack || error);
      throw error;
    }
  }


  async process() {
    this.logger.info("Rank web evidence Processor");
    super.process();

    this.chat = new ChatOpenAI({
      temperature: IEngineConstants.rankWebEvidenceModel.temperature,
      maxTokens: IEngineConstants.rankWebEvidenceModel.maxOutputTokens,
      modelName: IEngineConstants.rankWebEvidenceModel.name,
      verbose: IEngineConstants.rankWebEvidenceModel.verbose,
    });

    const subProblemsLimit = Math.min(
      this.memory.subProblems.length,
      IEngineConstants.maxSubProblems
    );

    const skipSubProblemsIndexes: number[] = [];

    const currentGeneration = 0;

    const subProblemsPromises = Array.from(
      { length: subProblemsLimit },
      async (_, subProblemIndex) => {
        this.logger.info(`Ranking sub problem ${subProblemIndex}`);
        const subProblem = this.memory.subProblems[subProblemIndex];
        if (!skipSubProblemsIndexes.includes(subProblemIndex)) {
          if (subProblem.policies) {
            const policies = subProblem.policies.populations[currentGeneration];
            for (
              let p = 0;
              p <
              Math.min(
                policies.length,
                IEngineConstants.maxTopPoliciesToProcess
              );
              p++
            ) {
              const policy = policies[p];
              try {
                await this.rankWebEvidence(policy, subProblemIndex);
                this.logger.debug(
                  `Finished ranking sub problem ${subProblemIndex} for policy ${policy}`
                );
              } catch (error: any) {
                this.logger.error(error.stack || error);
                throw error;
              }
            }
          }
        } else {
          this.logger.info(`Skipping sub problem ${subProblemIndex}`);
        }
      }
    );

    await Promise.all(subProblemsPromises);
    this.logger.info("Finished ranking all web evidence");
  }
}
