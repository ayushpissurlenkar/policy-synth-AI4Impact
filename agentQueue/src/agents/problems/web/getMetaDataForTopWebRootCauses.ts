import { Page } from "puppeteer";
import puppeteer, { Browser } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { IEngineConstants } from "../../../constants.js";
import metascraperFactory from "metascraper";
import metascraperAuthor from "metascraper-author";
import metascraperDate from "metascraper-date";
import metascraperDescription from "metascraper-description";
import metascraperImage from "metascraper-image";
import metascraperLogo from "metascraper-logo";
import metascraperClearbit from "metascraper-clearbit";
import metascraperPublisher from "metascraper-publisher";
import metascraperTitle from "metascraper-title";
import metascraperUrl from "metascraper-url";

import { HumanChatMessage, SystemChatMessage } from "langchain/schema";

import { ChatOpenAI } from "langchain/chat_models/openai";
import ioredis from "ioredis";
import { GetWebPagesProcessor } from "../../solutions/web/getWebPages.js";
import { RootCauseExamplePrompts } from "./rootCauseExamplePrompts.js";
import { RootCauseWebPageVectorStore } from "../../vectorstore/rootCauseWebPage.js";
import { CreateRootCausesSearchQueriesProcessor } from "../create/createRootCauseSearchQueries.js";
import { GetRootCausesWebPagesProcessor } from "./getRootCausesWebPages.js";
import { PdfReader } from "pdfreader";
import axios from "axios";

import { createGzip, gunzipSync, gzipSync } from "zlib";
import { promisify } from "util";
import { writeFile, readFile, existsSync } from "fs";

const gzip = promisify(createGzip);
const writeFileAsync = promisify(writeFile);
const readFileAsync = promisify(readFile);

const redis = new ioredis.default(process.env.REDIS_MEMORY_URL || "redis://localhost:6379");

const metascraper = metascraperFactory([
  metascraperAuthor(),
  metascraperDate(),
  metascraperDescription(),
  metascraperImage(),
  metascraperLogo(),
  metascraperClearbit(),
  metascraperPublisher(),
  metascraperTitle(),
  metascraperUrl(),
]);

//@ts-ignore
puppeteer.use(StealthPlugin());

export class GetMetaDataForTopWebRootCausesProcessor extends GetRootCausesWebPagesProcessor {
  async processPageText(
    text: string,
    subProblemIndex: number | undefined,
    url: string,
    type: IEngineWebPageTypes | PSEvidenceWebPageTypes | PSRootCauseWebPageTypes,
    entityIndex: number | undefined,
    policy: PSPolicy | undefined = undefined,
  ) {
    this.logger.debug(`Processing page text ${text.slice(0, 150)} for ${url} for ${type} search results`);

    try {
      const metadata = await metascraper({ html: text, url });
      const metadataToSave = {
        metaDate: metadata.date,
        metaDescription: metadata.description,
        metaImageUrl: metadata.image,
        //@ts-ignore
        metaLogoUrl: metadata.logo,
        metaPublisher: metadata.publisher,
        metaTitle: metadata.title,
        metaAuthor: metadata.author,
      } as PSWebPageMetadata;

      this.logger.debug(`Got metadata ${JSON.stringify(metadataToSave, null, 2)}`);

      // TODO: need to access vectorStoreId some other way (policy always undefined)
      await this.rootCauseWebPageVectorStore.saveWebPageMetadata(policy?.vectorStoreId!, metadataToSave);
    } catch (e: any) {
      this.logger.error(`Error in processPageText`);
      this.logger.error(e.stack || e);
    }
  }

  async getAndProcessPdf(
    subProblemIndex: number | undefined,
    url: string,
    type: IEngineWebPageTypes | PSEvidenceWebPageTypes | PSRootCauseWebPageTypes,
    entityIndex: number | undefined,
    policy: PSPolicy | undefined = undefined,
  ) {
    return new Promise<void>(async (resolve, reject) => {
      this.logger.info("getAndProcessPdf");

      try {
        let finalText = "";
        let pdfBuffer;

        const filePath = `webPagesCache/${this.memory.groupId}/${encodeURIComponent(url)}.gz`;

        if (existsSync(filePath)) {
          this.logger.info("Got cached PDF");
          const cachedPdf = await readFileAsync(filePath);
          pdfBuffer = gunzipSync(cachedPdf);
        } else {
          const sleepingForMs =
            IEngineConstants.minSleepBeforeBrowserRequest +
            Math.random() * IEngineConstants.maxAdditionalRandomSleepBeforeBrowserRequest;

          this.logger.info(`Fetching PDF ${url} in ${sleepingForMs} ms`);

          await new Promise((r) => setTimeout(r, sleepingForMs));

          const axiosResponse = await axios.get(url, {
            responseType: "arraybuffer",
          });

          pdfBuffer = axiosResponse.data;

          if (pdfBuffer) {
            this.logger.debug(`Caching PDF response`);
            const gzipData = gzipSync(pdfBuffer);
            await writeFileAsync(filePath, gzipData);
            this.logger.debug("Have cached PDF response");
          }
        }

        if (pdfBuffer) {
          finalText = pdfBuffer.toString();
          await this.processPageText(finalText, subProblemIndex, url, type, entityIndex, policy);
          resolve();
        } else {
          this.logger.error(`No PDF buffer`);
          resolve();
        }
      } catch (e) {
        this.logger.error(`Error in get pdf`);
        this.logger.error(e);
        resolve();
      }
    });
  }

  async getAndProcessHtml(
    subProblemIndex: number | undefined = undefined,
    url: string,
    browserPage: Page,
    type: IEngineWebPageTypes | PSEvidenceWebPageTypes | PSRootCauseWebPageTypes,
    entityIndex: number | undefined,
    policy: PSPolicy | undefined = undefined,
  ) {
    try {
      let finalText, htmlText;

      this.logger.debug(`Getting HTML for ${url}`);

      const filePath = `webPagesCache/${this.memory.groupId}/${encodeURIComponent(url)}.gz`;

      if (existsSync(filePath)) {
        this.logger.info("Got cached HTML");
        const cachedData = await readFileAsync(filePath);
        htmlText = gunzipSync(cachedData).toString();
      } else {
        const sleepingForMs =
          IEngineConstants.minSleepBeforeBrowserRequest +
          Math.random() * IEngineConstants.maxAdditionalRandomSleepBeforeBrowserRequest;

        this.logger.info(`Fetching HTML page ${url} in ${sleepingForMs} ms`);

        await new Promise((r) => setTimeout(r, sleepingForMs));

        const response = await browserPage.goto(url, {
          waitUntil: "networkidle0",
        });
        if (response) {
          htmlText = await response.text();
          if (htmlText) {
            this.logger.debug(`Caching response`);
            const gzipData = gzipSync(Buffer.from(htmlText));
            await writeFileAsync(filePath, gzipData);
          }
        }
      }

      if (htmlText) {
        finalText = htmlText;

        //this.logger.debug(`Got HTML text: ${finalText}`);
        await this.processPageText(finalText, subProblemIndex, url, type, entityIndex, policy);
      } else {
        this.logger.error(`No HTML text found for ${url}`);
      }
    } catch (e: any) {
      this.logger.error(`Error in get html`);
      this.logger.error(e.stack || e);
    }
  }

  async getAndProcessRootCausePage(url: string, browserPage: Page, type: PSRootCauseWebPageTypes) {
    if (url.toLowerCase().endsWith(".pdf")) {
      await this.getAndProcessPdf(-1, url, type, undefined, undefined);
    } else {
      await this.getAndProcessHtml(-1, url, browserPage, type, undefined, undefined);
    }

    return true;
  }

  async refineWebRootCauses(page: Page) {
    const limit = 10;

    try {
      for (const rootCauseType of IEngineConstants.rootCauseFieldTypes) {
        const searchType = IEngineConstants.simplifyEvidenceType(rootCauseType);
        const results = await this.rootCauseWebPageVectorStore.getTopPagesForProcessing(
          this.memory.groupId,
          searchType,
          limit,
        );

        this.logger.debug(`Got ${results.data.Get["RootCauseWebPage"].length} WebPage results from Weaviate`);

        if (results.data.Get["RootCauseWebPage"].length === 0) {
          this.logger.error(`No results for ${searchType}`);
          continue;
        }

        let pageCounter = 0;
        for (const retrievedObject of results.data.Get["RootCauseWebPage"]) {
          const webPage = retrievedObject as PSRootCauseRawWebPageData;
          const id = webPage._additional!.id!;

          this.logger.info(`Score ${webPage.totalScore} for ${webPage.url}`);
          this.logger.debug(
            `All scores ${webPage.rootCauseRelevanceToProblemStatementScore} ${webPage.rootCauseRelevanceToTypeScore} ${webPage.rootCauseConfidenceScore} ${webPage.rootCauseQualityScore}`,
          );

          await this.getAndProcessRootCausePage(webPage.url, page, searchType as PSRootCauseWebPageTypes);

          this.logger.info(`(+${pageCounter++}) - ${id} - Updated`);
        }
      }
    } catch (error: any) {
      this.logger.error(error.stack || error);
      throw error;
    }
  }

  async processSubProblems(browser: Browser) {
    this.logger.info("Refining root causes");
    const newPage = await browser.newPage();
    newPage.setDefaultTimeout(IEngineConstants.webPageNavTimeout);
    newPage.setDefaultNavigationTimeout(IEngineConstants.webPageNavTimeout);
    await newPage.setUserAgent(IEngineConstants.currentUserAgent);

    try {
      await this.refineWebRootCauses(newPage);
      this.logger.debug("Finished refining root causes");
    } catch (error: any) {
      this.logger.error(error.stack || error);
      throw error;
    }
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
    this.logger.info("Get Web Meta Data Processor");
    //super.process();

    await this.getAllPages();

    this.logger.info(`Refined ${this.totalPagesSave} pages`);
    this.logger.info("Get Web Meta Data Processor Complete");
  }
}
