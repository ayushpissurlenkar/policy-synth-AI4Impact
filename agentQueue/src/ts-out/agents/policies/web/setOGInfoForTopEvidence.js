import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { IEngineConstants } from "../../../constants.js";
import metascraperFactory from 'metascraper';
import metascraperAuthor from 'metascraper-author';
import metascraperDate from 'metascraper-date';
import metascraperDescription from 'metascraper-description';
import metascraperImage from 'metascraper-image';
import metascraperLogo from 'metascraper-logo';
import metascraperClearbit from 'metascraper-clearbit';
import metascraperPublisher from 'metascraper-publisher';
import metascraperTitle from 'metascraper-title';
import metascraperUrl from 'metascraper-url';
import ioredis from "ioredis";
import { GetEvidenceWebPagesProcessor } from "./getEvidenceWebPages.js";
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
    metascraperUrl()
]);
//@ts-ignore
puppeteer.use(StealthPlugin());
export class GetRefinedEvidenceProcessor extends GetEvidenceWebPagesProcessor {
    async getRefinedEvidenceTextAIAnalysis(subProblemIndex, policy, type, text) {
        this.logger.info("Get Refined Evidence AI Analysis");
        const messages = this.renderEvidenceScanningPrompt(subProblemIndex, policy, type, text);
        const analysis = (await this.callLLM("web-get-refined-evidence", IEngineConstants.getRefinedEvidenceModel, messages, true, true));
        return analysis;
    }
    async processPageText(text, subProblemIndex, url, type, entityIndex, policy = undefined) {
        this.logger.debug(`Processing page text ${text.slice(0, 150)} for ${url} for ${type} search results ${subProblemIndex} sub problem index`);
        try {
            metascraper({ html: text, url }).then((metadata) => {
                this.logger.debug(`Got metadata ${JSON.stringify(metadata, null, 2)}`);
            });
        }
        catch (e) {
            this.logger.error(`Error in processPageText`);
            this.logger.error(e.stack || e);
        }
    }
    async getAndProcessPdf(subProblemIndex, url, type, entityIndex, policy = undefined) {
        return new Promise(async (resolve, reject) => {
            this.logger.info("getAndProcessPdf");
            try {
                let finalText = "";
                let pdfBuffer;
                const filePath = `webPagesCache/${this.memory.groupId}/${encodeURIComponent(url)}.gz`;
                if (existsSync(filePath)) {
                    this.logger.info("Got cached PDF");
                    const cachedPdf = await readFileAsync(filePath);
                    pdfBuffer = gunzipSync(cachedPdf);
                }
                else {
                    const sleepingForMs = IEngineConstants.minSleepBeforeBrowserRequest +
                        Math.random() *
                            IEngineConstants.maxAdditionalRandomSleepBeforeBrowserRequest;
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
                }
                else {
                    this.logger.error(`No PDF buffer`);
                    resolve();
                }
            }
            catch (e) {
                this.logger.error(`Error in get pdf`);
                this.logger.error(e);
                resolve();
            }
        });
    }
    async getAndProcessHtml(subProblemIndex, url, browserPage, type, entityIndex, policy = undefined) {
        try {
            let finalText, htmlText;
            this.logger.debug(`Getting HTML for ${url}`);
            const filePath = `webPagesCache/${this.memory.groupId}/${encodeURIComponent(url)}.gz`;
            if (existsSync(filePath)) {
                this.logger.info("Got cached HTML");
                const cachedData = await readFileAsync(filePath);
                htmlText = gunzipSync(cachedData).toString();
            }
            else {
                const sleepingForMs = IEngineConstants.minSleepBeforeBrowserRequest +
                    Math.random() *
                        IEngineConstants.maxAdditionalRandomSleepBeforeBrowserRequest;
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
            }
            else {
                this.logger.error(`No HTML text found for ${url}`);
            }
        }
        catch (e) {
            this.logger.error(`Error in get html`);
            this.logger.error(e.stack || e);
        }
    }
    async getAndProcessEvidencePage(subProblemIndex, url, browserPage, type, policy) {
        if (url.toLowerCase().endsWith(".pdf")) {
            await this.getAndProcessPdf(subProblemIndex, url, type, undefined, policy);
        }
        else {
            await this.getAndProcessHtml(subProblemIndex, url, browserPage, type, undefined, policy);
        }
        return true;
    }
    async refineWebEvidence(policy, subProblemIndex, page) {
        const limit = 10;
        try {
            for (const evidenceType of IEngineConstants.policyEvidenceFieldTypes) {
                const searchType = IEngineConstants.simplifyEvidenceType(evidenceType);
                const results = await this.evidenceWebPageVectorStore.getTopPagesForProcessing(this.memory.groupId, subProblemIndex, policy.title, searchType, limit);
                this.logger.debug(`Got ${results.data.Get["EvidenceWebPage"].length} WebPage results from Weaviate`);
                if (results.data.Get["EvidenceWebPage"].length === 0) {
                    this.logger.error(`No results for ${policy.title} ${searchType}`);
                    continue;
                }
                let pageCounter = 0;
                for (const retrievedObject of results.data.Get["EvidenceWebPage"]) {
                    const webPage = retrievedObject;
                    const id = webPage._additional.id;
                    this.logger.info(`Score ${webPage.totalScore} for ${webPage.url}`);
                    this.logger.debug(`All scores ${webPage.relevanceScore} ${webPage.relevanceToTypeScore} ${webPage.confidenceScore} ${webPage.qualityScore}`);
                    policy.vectorStoreId = id;
                    await this.getAndProcessEvidencePage(subProblemIndex, webPage.url, page, searchType, policy);
                    this.logger.info(`${subProblemIndex} - (+${pageCounter++}) - ${id} - Updated`);
                }
            }
        }
        catch (error) {
            this.logger.error(error.stack || error);
            throw error;
        }
    }
    async processSubProblems(browser) {
        const subProblemsLimit = Math.min(this.memory.subProblems.length, IEngineConstants.maxSubProblems);
        const skipSubProblemsIndexes = [];
        const currentGeneration = 0;
        const subProblemsPromises = Array.from({ length: subProblemsLimit }, async (_, subProblemIndex) => {
            this.logger.info(`Refining evidence for sub problem ${subProblemIndex}`);
            const newPage = await browser.newPage();
            newPage.setDefaultTimeout(IEngineConstants.webPageNavTimeout);
            newPage.setDefaultNavigationTimeout(IEngineConstants.webPageNavTimeout);
            await newPage.setUserAgent(IEngineConstants.currentUserAgent);
            const subProblem = this.memory.subProblems[subProblemIndex];
            if (!skipSubProblemsIndexes.includes(subProblemIndex)) {
                if (subProblem.policies) {
                    const policies = subProblem.policies.populations[currentGeneration];
                    for (let p = 0; p <
                        Math.min(policies.length, IEngineConstants.maxTopPoliciesToProcess); p++) {
                        const policy = policies[p];
                        try {
                            await this.refineWebEvidence(policy, subProblemIndex, newPage);
                            this.logger.debug(`Finished ranking sub problem ${subProblemIndex} for policy ${policy}`);
                        }
                        catch (error) {
                            this.logger.error(error.stack || error);
                            throw error;
                        }
                    }
                }
            }
            else {
                this.logger.info(`Skipping sub problem ${subProblemIndex}`);
            }
        });
        await Promise.all(subProblemsPromises);
        this.logger.info("Finished rating all web evidence");
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
