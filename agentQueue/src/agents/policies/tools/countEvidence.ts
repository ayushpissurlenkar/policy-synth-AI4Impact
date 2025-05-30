import { BaseProcessor } from "../../baseProcessor.js";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { HumanChatMessage, SystemChatMessage } from "langchain/schema";
import ioredis from "ioredis";
import { IEngineConstants } from "../../../constants.js";
import { EvidenceWebPageVectorStore } from "../../vectorstore/evidenceWebPage.js";
const redis = new ioredis.default(
  process.env.REDIS_MEMORY_URL || "redis://localhost:6379"
);

export class CountWebEvidenceProcessor extends BaseProcessor {
  evidenceWebPageVectorStore = new EvidenceWebPageVectorStore();

  async countAll(policy: PSPolicy, subProblemIndex: number) {
    let offset = 0;
    const limit = 100;
    const logDetail = false;

    this.logger.info(`Counting all web evidence for policy ${policy.title}`);
    try {
      for (const evidenceType of IEngineConstants.policyEvidenceFieldTypes) {
        //this.logger.info(`Counting all web evidence for type ${evidenceType}`);
        let offset = 0;
        let refinedCount = 0;
        let totalCount = 0;
        let revidenceCount = 0;
        let reommendationCount = 0;
        const searchType = IEngineConstants.simplifyEvidenceType(evidenceType);

        while (true) {
          const results =
            await this.evidenceWebPageVectorStore.getTopWebPagesForProcessing(
              this.memory.groupId,
              subProblemIndex,
              searchType,
              policy.title,
              limit,
              offset
            );

          /*this.logger.debug(
            `Got ${results.data.Get["EvidenceWebPage"].length} WebPage results from Weaviate`
          );*/

          if (results.data.Get["EvidenceWebPage"].length === 0) {
            //this.logger.info("Exiting");
            break;
          }

          let pageCounter = 0;
          for (const retrievedObject of results.data.Get["EvidenceWebPage"]) {
            const webPage = retrievedObject as PSEvidenceRawWebPageData;
            const id = webPage._additional!.id!;
            if (logDetail)
              this.logger.info(
                `${webPage.searchType} - ${webPage.totalScore} - ${
                  webPage.relevanceScore
                } - ${
                  webPage.mostImportantPolicyEvidenceInTextContext
                    ? "refined"
                    : "original"
                } -  ${webPage.url}`
              );
            if (webPage.mostImportantPolicyEvidenceInTextContext) {
              revidenceCount +=
                webPage.mostImportantPolicyEvidenceInTextContext.length;
            }
            if (webPage.whatPolicyNeedsToImplementInResponseToEvidence) {
              reommendationCount +=
                webPage.whatPolicyNeedsToImplementInResponseToEvidence.length;
            }
            totalCount++;
            if (webPage.mostImportantPolicyEvidenceInTextContext) {
              refinedCount++;
            }
          }
          this.logger.info(
            `${searchType} Total: ${totalCount} - Refined: ${refinedCount} - Evidence: ${revidenceCount} - Recommendation: ${reommendationCount}`
          );
          offset += limit;
        }
      }
    } catch (error: any) {
      this.logger.error(error.stack || error);
      throw error;
    }
  }

  async process() {
    this.logger.info("Count evidence Processor");
    super.process();

    const subProblemsLimit = Math.min(
      this.memory.subProblems.length,
      IEngineConstants.maxSubProblems
    );

    const skipSubProblemsIndexes: number[] = [];

    const currentGeneration = 0;

    for (
      let subProblemIndex = 0;
      subProblemIndex < subProblemsLimit;
      subProblemIndex++
    ) {
      this.logger.info(`Count evidence for sub problem ${subProblemIndex}`);
      const subProblem = this.memory.subProblems[subProblemIndex];
      if (!skipSubProblemsIndexes.includes(subProblemIndex)) {
        if (subProblem.policies) {
          const policies = subProblem.policies.populations[currentGeneration];
          for (
            let p = 0;
            p <
            Math.min(policies.length, IEngineConstants.maxTopPoliciesToProcess);
            p++
          ) {
            const policy = policies[p];
            try {
              await this.countAll(policy, subProblemIndex);
              this.logger.debug(
                `Finished counting sub problem ${subProblemIndex} for policy ${policy.title}\n\n`
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
    this.logger.info("Finished rating all web evidence");
  }
}

async function run() {
  const projectId = process.argv[2];

  if (projectId) {
    const output = await redis.get(`st_mem:${projectId}:id`);
    const memory = JSON.parse(output!) as IEngineInnovationMemoryData;

    const counts = new CountWebEvidenceProcessor({} as any, memory);
    await counts.process();
    process.exit(0);
  } else {
    console.log("No project id provided");
    process.exit(1);
  }
}

run();
