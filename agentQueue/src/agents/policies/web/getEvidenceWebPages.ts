import { Page } from "puppeteer";
import puppeteer, { Browser } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { IEngineConstants } from "../../../constants.js";

import { HumanChatMessage, SystemChatMessage } from "langchain/schema";

import { ChatOpenAI } from "langchain/chat_models/openai";
import ioredis from "ioredis";
import { GetWebPagesProcessor } from "../../solutions/web/getWebPages.js";
import { EvidenceExamplePrompts } from "./evidenceExamplePrompts.js";
import { EvidenceWebPageVectorStore } from "../../vectorstore/evidenceWebPage.js";
import { CreateEvidenceSearchQueriesProcessor } from "../create/createEvidenceSearchQueries.js";

const redis = new ioredis.default(
  process.env.REDIS_MEMORY_URL || "redis://localhost:6379"
);

//@ts-ignore
puppeteer.use(StealthPlugin());

const onlyCheckWhatNeedsToBeScanned = false;
class EvidenceTypeLookup {
  private static evidenceTypeMapping: Record<PSEvidenceWebPageTypes, string> = {
    positiveEvidence: "allPossiblePositiveEvidenceIdentifiedInTextContext",
    negativeEvidence: "allPossibleNegativeEvidenceIdentifiedInTextContext",
    neutralEvidence: "allPossibleNeutralEvidenceIdentifiedInTextContext",
    economicEvidence: "allPossibleEconomicEvidenceIdentifiedInTextContext",
    scientificEvidence: "allPossibleScientificEvidenceIdentifiedInTextContext",
    culturalEvidence: "allPossibleCulturalEvidenceIdentifiedInTextContext",
    environmentalEvidence:
      "allPossibleEnvironmentalEvidenceIdentifiedInTextContext",
    legalEvidence: "allPossibleLegalEvidenceIdentifiedInTextContext",
    technologicalEvidence:
      "allPossibleTechnologicalEvidenceIdentifiedInTextContext",
    geopoliticalEvidence:
      "allPossibleGeopoliticalEvidenceIdentifiedInTextContext",
    caseStudies: "allPossibleCaseStudiesIdentifiedInTextContext",
    stakeholderOpinions:
      "allPossibleStakeholderOpinionsIdentifiedInTextContext",
    expertOpinions: "allPossibleExpertOpinionsIdentifiedInTextContext",
    publicOpinions: "allPossiblePublicOpinionsIdentifiedInTextContext",
    historicalContext: "allPossibleHistoricalContextIdentifiedInTextContext",
    ethicalConsiderations:
      "allPossibleEthicalConsiderationsIdentifiedInTextContext",
    longTermImpact: "allPossibleLongTermImpactIdentifiedInTextContext",
    shortTermImpact: "allPossibleShortTermImpactIdentifiedInTextContext",
    localPerspective: "allPossibleLocalPerspectiveIdentifiedInTextContext",
    globalPerspective: "allPossibleGlobalPerspectiveIdentifiedInTextContext",
    costAnalysis: "allPossibleCostAnalysisIdentifiedInTextContext",
    implementationFeasibility:
      "allPossibleImplementationFeasibilityIdentifiedInTextContext",
  };

  public static getPropertyName(
    evidenceType: PSEvidenceWebPageTypes
  ): string | undefined {
    return this.evidenceTypeMapping[evidenceType];
  }
}

export class GetEvidenceWebPagesProcessor extends GetWebPagesProcessor {
  evidenceWebPageVectorStore = new EvidenceWebPageVectorStore();
  renderEvidenceScanningPrompt(
    subProblemIndex: number,
    policy: PSPolicy,
    type: PSEvidenceWebPageTypes,
    text: string
  ) {
    const nameOfColumn = EvidenceTypeLookup.getPropertyName(type);
    if (!nameOfColumn) {
      throw new Error(`No corresponding property found for type: ${type}`);
    }

    return [
      new SystemChatMessage(
        `
        Your are an expert in analyzing textual data:

        Important Instructions:
        1. Examine the "Text context" and determine how it relates to the problem and the specified policy proposal.
        2. Identify any specific raw potential ${type} in the "Text Context" and include them in the '${nameOfColumn}' JSON array. We will analyse this later.
        3. Include any paragraphs with potential ${type} also in the  the "Text Context" in the 'mostRelevantParagraphs' JSON array.
        4. Always write out a summary, relevanceToPolicyProposal, mostRelevantParagraphs & ${nameOfColumn}

        - Only use information found within the "Text Context" - do not create your own data.
        - Never output in markdown format.
        - Never include references or citations as part of the 'mostRelevantParagraphs' array.
        - Always output your results in the JSON format with no additional explanation.
        - Let's think step-by-step.

        Example:

        Problem:
        Ineffectiveness of Democratic Institutions
        Democratic institutions are consistently failing to deliver on policy expectations, leading to public disapproval.

        Policy Proposal:
        Public-Friendly Open Data Platform
        Create an intuitively navigable, comprehensive platform that renders government data comprehensible and accessible to the general public, thereby fostering transparency and enhancing democratic trust.

        Web page type: ${type}

        Text context:
        ${EvidenceExamplePrompts.render(type)}
        `
      ),
      new HumanChatMessage(
        `
        ${this.renderSubProblem(subProblemIndex)}

        Policy Proposal:
        ${policy.title}
        ${policy.description}

        Web page type: ${type}

        Text Context:
        ${text}

        JSON Output:
        `
      ),
    ];
  }
  async getEvidenceTokenCount(text: string, subProblemIndex: number, policy: PSPolicy, type: PSEvidenceWebPageTypes) {
    const emptyMessages = this.renderEvidenceScanningPrompt(
      subProblemIndex,
      policy,
      type,
      ""
    );

    const promptTokenCount = await this.chat!.getNumTokensFromMessages(
      emptyMessages
    );

    const textForTokenCount = new HumanChatMessage(text);

    const textTokenCount = await this.chat!.getNumTokensFromMessages([
      textForTokenCount,
    ]);

    const totalTokenCount =
      promptTokenCount.totalCount +
      textTokenCount.totalCount +
      IEngineConstants.getPageAnalysisModel.maxOutputTokens;

    return { totalTokenCount, promptTokenCount };
  }

  async getEvidenceTextAnalysis(
    subProblemIndex: number,
    policy: PSPolicy,
    type: PSEvidenceWebPageTypes,
    text: string
  ): Promise<PSEvidenceRawWebPageData | PSRefinedPolicyEvidence> {
    try {
      const { totalTokenCount, promptTokenCount } = await this.getEvidenceTokenCount(
        text,
        subProblemIndex,
        policy,
        type
      );

      this.logger.debug(
        `Total token count: ${totalTokenCount} Prompt token count: ${JSON.stringify(
          promptTokenCount
        )}`
      );

      let textAnalysis: PSEvidenceRawWebPageData;

      if (IEngineConstants.getPageAnalysisModel.tokenLimit < totalTokenCount) {
        const maxTokenLengthForChunk =
          IEngineConstants.getPageAnalysisModel.tokenLimit -
          promptTokenCount.totalCount -
          512;

        this.logger.debug(
          `Splitting text into chunks of ${maxTokenLengthForChunk} tokens`
        );

        const splitText = await this.splitText(
          text,
          maxTokenLengthForChunk,
          subProblemIndex
        );

        this.logger.debug(`Got ${splitText.length} splitTexts`);

        for (let t = 0; t < splitText.length; t++) {
          const currentText = splitText[t];

          let nextAnalysis = await this.getEvidenceAIAnalysis(
            subProblemIndex,
            policy,
            type,
            currentText
          );

          if (nextAnalysis) {
            if (t == 0) {
              textAnalysis = nextAnalysis;
            } else {
              textAnalysis = this.mergeAnalysisData(
                textAnalysis!,
                nextAnalysis
              ) as PSEvidenceRawWebPageData;
            }

            this.logger.debug(
              `Refined evidence text analysis (${t}): ${JSON.stringify(
                textAnalysis,
                null,
                2
              )}`
            );
          } else {
            this.logger.error(
              `Error getting AI analysis for text ${currentText}`
            );
          }
        }
      } else {
        textAnalysis = await this.getEvidenceAIAnalysis(
          subProblemIndex,
          policy,
          type,
          text
        );
        this.logger.debug(
          `Text analysis ${JSON.stringify(textAnalysis, null, 2)}`
        );
      }

      return textAnalysis!;
    } catch (error) {
      this.logger.error(`Error in getTextAnalysis: ${error}`);
      throw error;
    }
  }

  async getEvidenceAIAnalysis(
    subProblemIndex: number,
    policy: PSPolicy,
    type: PSEvidenceWebPageTypes,
    text: string
  ) {
    this.logger.info("Get Evidence AI Analysis");
    const messages = this.renderEvidenceScanningPrompt(
      subProblemIndex,
      policy,
      type,
      text
    );

    const analysis = (await this.callLLM(
      "web-get-evidence-pages",
      IEngineConstants.getPageAnalysisModel,
      messages,
      true,
      true
    )) as PSEvidenceRawWebPageData;

    return analysis;
  }

  mergeAnalysisData(
    data1: PSEvidenceRawWebPageData,
    data2: PSEvidenceRawWebPageData
  ): PSEvidenceRawWebPageData {
    return {
      mostRelevantParagraphs: [
        ...(data1.mostRelevantParagraphs || []),
        ...(data2.mostRelevantParagraphs || []),
      ],
      allPossiblePositiveEvidenceIdentifiedInTextContext: [
        ...(data1.allPossiblePositiveEvidenceIdentifiedInTextContext || []),
        ...(data2.allPossiblePositiveEvidenceIdentifiedInTextContext || []),
      ],
      allPossibleNegativeEvidenceIdentifiedInTextContext: [
        ...(data1.allPossibleNegativeEvidenceIdentifiedInTextContext || []),
        ...(data2.allPossibleNegativeEvidenceIdentifiedInTextContext || []),
      ],
      allPossibleNeutralEvidenceIdentifiedInTextContext: [
        ...(data1.allPossibleNeutralEvidenceIdentifiedInTextContext || []),
        ...(data2.allPossibleNeutralEvidenceIdentifiedInTextContext || []),
      ],
      allPossibleEconomicEvidenceIdentifiedInTextContext: [
        ...(data1.allPossibleEconomicEvidenceIdentifiedInTextContext || []),
        ...(data2.allPossibleEconomicEvidenceIdentifiedInTextContext || []),
      ],
      allPossibleScientificEvidenceIdentifiedInTextContext: [
        ...(data1.allPossibleScientificEvidenceIdentifiedInTextContext || []),
        ...(data2.allPossibleScientificEvidenceIdentifiedInTextContext || []),
      ],
      allPossibleCulturalEvidenceIdentifiedInTextContext: [
        ...(data1.allPossibleCulturalEvidenceIdentifiedInTextContext || []),
        ...(data2.allPossibleCulturalEvidenceIdentifiedInTextContext || []),
      ],
      allPossibleEnvironmentalEvidenceIdentifiedInTextContext: [
        ...(data1.allPossibleEnvironmentalEvidenceIdentifiedInTextContext ||
          []),
        ...(data2.allPossibleEnvironmentalEvidenceIdentifiedInTextContext ||
          []),
      ],
      allPossibleLegalEvidenceIdentifiedInTextContext: [
        ...(data1.allPossibleLegalEvidenceIdentifiedInTextContext || []),
        ...(data2.allPossibleLegalEvidenceIdentifiedInTextContext || []),
      ],
      allPossibleTechnologicalEvidenceIdentifiedInTextContext: [
        ...(data1.allPossibleTechnologicalEvidenceIdentifiedInTextContext ||
          []),
        ...(data2.allPossibleTechnologicalEvidenceIdentifiedInTextContext ||
          []),
      ],
      allPossibleGeopoliticalEvidenceIdentifiedInTextContext: [
        ...(data1.allPossibleGeopoliticalEvidenceIdentifiedInTextContext || []),
        ...(data2.allPossibleGeopoliticalEvidenceIdentifiedInTextContext || []),
      ],
      allPossibleCaseStudiesIdentifiedInTextContext: [
        ...(data1.allPossibleCaseStudiesIdentifiedInTextContext || []),
        ...(data2.allPossibleCaseStudiesIdentifiedInTextContext || []),
      ],
      allPossibleStakeholderOpinionsIdentifiedInTextContext: [
        ...(data1.allPossibleStakeholderOpinionsIdentifiedInTextContext || []),
        ...(data2.allPossibleStakeholderOpinionsIdentifiedInTextContext || []),
      ],
      allPossibleExpertOpinionsIdentifiedInTextContext: [
        ...(data1.allPossibleExpertOpinionsIdentifiedInTextContext || []),
        ...(data2.allPossibleExpertOpinionsIdentifiedInTextContext || []),
      ],
      allPossiblePublicOpinionsIdentifiedInTextContext: [
        ...(data1.allPossiblePublicOpinionsIdentifiedInTextContext || []),
        ...(data2.allPossiblePublicOpinionsIdentifiedInTextContext || []),
      ],
      allPossibleHistoricalContextIdentifiedInTextContext: [
        ...(data1.allPossibleHistoricalContextIdentifiedInTextContext || []),
        ...(data2.allPossibleHistoricalContextIdentifiedInTextContext || []),
      ],
      allPossibleEthicalConsiderationsIdentifiedInTextContext: [
        ...(data1.allPossibleEthicalConsiderationsIdentifiedInTextContext ||
          []),
        ...(data2.allPossibleEthicalConsiderationsIdentifiedInTextContext ||
          []),
      ],
      allPossibleLongTermImpactIdentifiedInTextContext: [
        ...(data1.allPossibleLongTermImpactIdentifiedInTextContext || []),
        ...(data2.allPossibleLongTermImpactIdentifiedInTextContext || []),
      ],
      allPossibleShortTermImpactIdentifiedInTextContext: [
        ...(data1.allPossibleShortTermImpactIdentifiedInTextContext || []),
        ...(data2.allPossibleShortTermImpactIdentifiedInTextContext || []),
      ],
      allPossibleLocalPerspectiveIdentifiedInTextContext: [
        ...(data1.allPossibleLocalPerspectiveIdentifiedInTextContext || []),
        ...(data2.allPossibleLocalPerspectiveIdentifiedInTextContext || []),
      ],
      allPossibleGlobalPerspectiveIdentifiedInTextContext: [
        ...(data1.allPossibleGlobalPerspectiveIdentifiedInTextContext || []),
        ...(data2.allPossibleGlobalPerspectiveIdentifiedInTextContext || []),
      ],
      allPossibleCostAnalysisIdentifiedInTextContext: [
        ...(data1.allPossibleCostAnalysisIdentifiedInTextContext || []),
        ...(data2.allPossibleCostAnalysisIdentifiedInTextContext || []),
      ],
      allPossibleImplementationFeasibilityIdentifiedInTextContext: [
        ...(data1.allPossibleImplementationFeasibilityIdentifiedInTextContext ||
          []),
        ...(data2.allPossibleImplementationFeasibilityIdentifiedInTextContext ||
          []),
      ],
      relevanceToPolicyProposal: data1.relevanceToPolicyProposal, // Assuming you want data from data1. Adjust as needed.
      confidenceScore: data1.confidenceScore || data2.confidenceScore,
      relevanceScore: data1.relevanceScore || data2.relevanceScore,
      qualityScore: data1.qualityScore || data2.qualityScore,
      tags: [...(data1.tags || []), ...(data2.tags || [])],
      entities: [...(data1.entities || []), ...(data2.entities || [])],
      contacts: [...(data1.contacts || []), ...(data2.contacts || [])],
      summary: data1.summary, // Assuming you want the summary from data1. Adjust as needed.
      url: data1.url, // Assuming you want the url from data1. Adjust as needed.
      searchType: data1.searchType,
      subProblemIndex: data1.subProblemIndex,
      entityIndex: data1.entityIndex,
      groupId: data1.groupId,
      communityId: data1.communityId,
      domainId: data1.domainId,
      _additional: data1._additional || data2._additional, // Assuming you want data from data1 when available. Adjust as needed.
    };
  }

  get maxWebPagesToGetByTopSearchPosition() {
    return IEngineConstants.maxEvidenceWebPagesToGetByTopSearchPosition;
  }

  async processPageText(
    text: string,
    subProblemIndex: number | undefined,
    url: string,
    type: IEngineWebPageTypes | PSEvidenceWebPageTypes,
    entityIndex: number | undefined,
    policy: PSPolicy | undefined = undefined
  ) {
    this.logger.debug(
      `Processing page text ${text.slice(
        0,
        150
      )} for ${url} for ${type} search results ${subProblemIndex} sub problem index`
    );

    try {
      const textAnalysis = (await this.getEvidenceTextAnalysis(
        subProblemIndex!,
        policy!,
        type as PSEvidenceWebPageTypes,
        text
      )) as unknown as PSEvidenceRawWebPageData;

      if (textAnalysis) {
        textAnalysis.url = url;
        textAnalysis.subProblemIndex = subProblemIndex;
        textAnalysis.searchType = type as PSEvidenceWebPageTypes;
        textAnalysis.groupId = this.memory.groupId;
        textAnalysis.communityId = this.memory.communityId;
        textAnalysis.domainId = this.memory.domainId;
        textAnalysis.policyTitle = policy!.title;

        if (
          Array.isArray(textAnalysis.contacts) &&
          textAnalysis.contacts.length > 0
        ) {
          if (
            typeof textAnalysis.contacts[0] === "object" &&
            textAnalysis.contacts[0] !== null
          ) {
            textAnalysis.contacts = textAnalysis.contacts.map((contact) =>
              JSON.stringify(contact)
            );
          }
        }

        this.logger.debug(
          `Saving text analysis ${JSON.stringify(textAnalysis, null, 2)}`
        );

        try {
          await this.evidenceWebPageVectorStore.postWebPage(textAnalysis);
          this.totalPagesSave += 1;
          this.logger.info(`Total ${this.totalPagesSave} saved pages`);
        } catch (e: any) {
          this.logger.error(`Error posting web page for url ${url}`);
          this.logger.error(e);
          this.logger.error(e.stack);
        }
      } else {
        this.logger.warn(`No text analysis for ${url}`);
      }
    } catch (e: any) {
      this.logger.error(`Error in processPageText`);
      this.logger.error(e.stack || e);
    }
  }

  get maxTopWebPagesToGet() {
    return IEngineConstants.maxTopWebPagesToGet;
  }

  async getAndProcessEvidencePage(
    subProblemIndex: number,
    url: string,
    browserPage: Page,
    type: PSEvidenceWebPageTypes,
    policy: PSPolicy
  ) {
    if (onlyCheckWhatNeedsToBeScanned) {
      const hasPage = await this.evidenceWebPageVectorStore.webPageExist(
        this.memory.groupId,
        url,
        type,
        subProblemIndex,
        undefined
      );
      if (hasPage) {
        this.logger.warn(
          `Already have scanned ${type} / ${subProblemIndex}  ${url}`
        );
      } else {
        this.logger.warn(`Need to scan ${type} / ${subProblemIndex}  ${url}`);
      }
    } else {
      if (url.toLowerCase().endsWith(".pdf")) {
        await this.getAndProcessPdf(
          subProblemIndex,
          url,
          type,
          undefined,
          policy
        );
      } else {
        await this.getAndProcessHtml(
          subProblemIndex,
          url,
          browserPage,
          type,
          undefined,
          policy
        );
      }
    }

    return true;
  }

  async processSubProblems(browser: Browser) {
    const promises = [];

    for (
      let subProblemIndex = 0;
      subProblemIndex <
      Math.min(this.memory.subProblems.length, IEngineConstants.maxSubProblems);
      subProblemIndex++
    ) {
      promises.push(
        (async () => {
          const newPage = await browser.newPage();
          newPage.setDefaultTimeout(IEngineConstants.webPageNavTimeout);
          newPage.setDefaultNavigationTimeout(
            IEngineConstants.webPageNavTimeout
          );

          await newPage.setUserAgent(IEngineConstants.currentUserAgent);

          const subProblem = this.memory.subProblems[subProblemIndex];

          const policies =
            subProblem.policies?.populations[
              subProblem.policies!.populations.length - 1
            ];

          if (policies) {
            for (
              let policyIndex = 0;
              policyIndex < policies.length;
              policyIndex++
            ) {
              this.logger.info(
                `Getting evidence web pages for policy ${policyIndex}/${
                  policies.length
                } of sub problem ${subProblemIndex} (${this.lastPopulationIndex(
                  subProblemIndex
                )})`
              );

              const policy = policies[policyIndex];

              for (const searchResultType of CreateEvidenceSearchQueriesProcessor.evidenceWebPageTypesArray) {
                const urlsToGet =
                  policy.evidenceSearchResults![searchResultType];

                if (urlsToGet) {
                  for (let i = 0; i < urlsToGet.length; i++) {
                    await this.getAndProcessEvidencePage(
                      subProblemIndex,
                      urlsToGet[i].url,
                      newPage,
                      searchResultType,
                      policy
                    );
                  }
                } else {
                  console.error(
                    `No urls to get for ${searchResultType} for policy ${policyIndex} of sub problem ${subProblemIndex} (${this.lastPopulationIndex})`
                  );
                }
              }
            }

            await this.saveMemory();
          }

          await newPage.close();

          this.logger.info(
            `Finished and closed page for ${this.memory.subProblems[subProblemIndex].title}`
          );
        })()
      );
    }

    await Promise.all(promises);
  }

  async getAllPages() {
    const browser = await puppeteer.launch({ headless: "new" });
    this.logger.debug("Launching browser");

    const browserPage = await browser.newPage();
    browserPage.setDefaultTimeout(IEngineConstants.webPageNavTimeout);
    browserPage.setDefaultNavigationTimeout(IEngineConstants.webPageNavTimeout);

    await browserPage.setUserAgent(IEngineConstants.currentUserAgent);

    await this.processSubProblems(browser);

    await this.saveMemory();

    await browser.close();

    this.logger.info("Browser closed");
  }

  async process() {
    this.logger.info("Get Evidence Web Pages Processor");
    //super.process();

    this.chat = new ChatOpenAI({
      temperature: IEngineConstants.getPageAnalysisModel.temperature,
      maxTokens: IEngineConstants.getPageAnalysisModel.maxOutputTokens,
      modelName: IEngineConstants.getPageAnalysisModel.name,
      verbose: IEngineConstants.getPageAnalysisModel.verbose,
    });

    await this.getAllPages();

    this.logger.info(`Saved ${this.totalPagesSave} pages`);
    this.logger.info("Get Evidence Web Pages Processor Complete");
  }
}
