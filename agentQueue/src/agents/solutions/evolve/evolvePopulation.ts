import { BaseProcessor } from "../../baseProcessor.js";
import { ChatOpenAI } from "langchain/chat_models/openai";
import { HumanChatMessage, SystemChatMessage } from "langchain/schema";

import { IEngineConstants } from "../../../constants.js";
import { CreateSolutionsProcessor } from "../create/createSolutions.js";

//TODO: Pentalty for similar ideas in the ranking somehow
//TODO: Track the evolution of the population with a log of parents and mutations, family tree
export class EvolvePopulationProcessor extends CreateSolutionsProcessor {
  renderSolution(solution: IEngineSolution) {
    return JSON.stringify(
      {
        title: solution.title,
        description: solution.description,
        mainBenefitOfSolutionComponent:
          solution.mainBenefitOfSolutionComponent ||
          solution.mainBenefitOfSolution,
        mainObstacleToSolutionComponentAdoption:
          solution.mainObstacleToSolutionComponentAdoption ||
          solution.mainObstacleToSolutionAdoption,
      },
      null,
      2
    );
  }

  renderRecombinationPrompt(
    parentA: IEngineSolution,
    parentB: IEngineSolution,
    subProblemIndex: number
  ) {
    return [
      new SystemChatMessage(
        `
        As an AI genetic algorithm expert, your task is to create a new solution component from two parent solution components: "Solution Component Parent A" and "Solution Component Parent B".

        Instructions:
        1. Use one best attribute from "Parent A" and one best attribute from "Parent B" to create a new solution component with one core idea. Be very creative here do not just take one idea from Parent A and one idea from Parent B, make something unique and innovative.
        2. Aim to keep the solution component simple and easily turned into parts of larger policy proposals later.
        3. Avoid overly complex combinations that would make the solution component impractical or difficult to understand.
        4. If the combined solution has more than two unique core ideas remove all but two of the core ideas in the solution component, if the ideas are closely related then do not filter them out.
        5. Phrases that describe the impact or outcome of implementing the core ideas should not be counted as separate core ideas.
        6. Core ideas are distinct concepts or strategies that are central to the solution component.
        7. Do not refer to "the merged solution component" in your output, the solution component should be presented as a standalone solution component.        ${
          this.memory.customInstructions.createSolutions
            ? `
          Important Instructions (override the previous instructions if needed): ${this.memory.customInstructions.createSolutions}
          `
            : ""
        }

        Always output your merged solution component in the following JSON format: { title, description, mainBenefitOfSolutionComponent, mainObstacleToSolutionComponentAdoption }. Do not add any new JSON properties.
        Let's think step by step.
        `
      ),
      new HumanChatMessage(
        `
        ${this.renderProblemStatementSubProblemsAndEntities(subProblemIndex)}

        Solution Component Parent A:
        ${this.renderSolution(parentA)}

        Solution Component Parent B:
        ${this.renderSolution(parentB)}

        Generate and output JSON for the merged solution component below:
        `
      ),
    ];
  }

  renderMutatePrompt(
    individual: IEngineSolution,
    subProblemIndex: number,
    mutateRate: IEngineMutationRates
  ) {
    this.logger.debug(`Mutate rate: ${mutateRate}`);

    return [
      new SystemChatMessage(
        `
        As an AI expert specializing in genetic algorithms, your task is to mutate the following solution component.

        Instructions:
        1. Implement mutations corresponding to a ${mutateRate} mutation rate.
        2. Mutation can involve introducing new attributes, modifying existing ones, or removing less important ones.
        3. Ensure the mutation is creative, meaningful, and continues to offer a viable solution component to part of the presented problem.
        4. Avoid referring to your output as "the merged solution component" or "the mutated solution component". Instead, present it as a standalone solution component.
        ${
          this.memory.customInstructions.createSolutions
            ? `
          Important Instructions (override the previous instructions if needed): ${this.memory.customInstructions.createSolutions}
          `
            : ""
        }

        Always format your mutated solution component in the following JSON structure: { title, description, mainBenefitOfSolutionComponent, mainObstacleToSolutionComponentAdoption }. Do not introduce any new JSON properties.
        Let's think step by step.
        `
      ),
      new HumanChatMessage(
        `
        ${this.renderProblemStatementSubProblemsAndEntities(subProblemIndex)}

        Solution component to mutate:
        ${this.renderSolution(individual)}

        Generate and output JSON for the mutated solution component below:
        `
      ),
    ];
  }

  async performRecombination(
    parentA: IEngineSolution,
    parentB: IEngineSolution,
    subProblemIndex: number
  ) {
    this.chat = new ChatOpenAI({
      temperature: IEngineConstants.evolutionRecombineModel.temperature,
      maxTokens: IEngineConstants.evolutionRecombineModel.maxOutputTokens,
      modelName: IEngineConstants.evolutionRecombineModel.name,
      verbose: IEngineConstants.evolutionRecombineModel.verbose,
    });

    return (await this.callLLM(
      "evolve-recombine-population",
      IEngineConstants.evolutionRecombineModel,
      this.renderRecombinationPrompt(parentA, parentB, subProblemIndex)
    )) as IEngineSolution;
  }

  async recombine(
    parentA: IEngineSolution,
    parentB: IEngineSolution,
    subProblemIndex: number
  ) {
    const offspring = await this.performRecombination(
      parentA,
      parentB,
      subProblemIndex
    );
    return offspring;
  }

  async performMutation(
    individual: IEngineSolution,
    subProblemIndex: number,
    mutateRate: IEngineMutationRates
  ) {
    this.logger.debug("Performing mutation");
    this.chat = new ChatOpenAI({
      temperature: IEngineConstants.evolutionMutateModel.temperature,
      maxTokens: IEngineConstants.evolutionMutateModel.maxOutputTokens,
      modelName: IEngineConstants.evolutionMutateModel.name,
      verbose: IEngineConstants.evolutionMutateModel.verbose,
    });

    this.logger.debug("Before mutation");

    try {
      const mutant = (await this.callLLM(
        "evolve-mutate-population",
        IEngineConstants.evolutionMutateModel,
        this.renderMutatePrompt(individual, subProblemIndex, mutateRate)
      )) as IEngineSolution;

      this.logger.debug("After mutation");

      return mutant;
    } catch (error) {
      this.logger.error("Error in mutation");
      this.logger.error(error);
      throw error;
    }
  }

  async mutate(
    individual: IEngineSolution,
    subProblemIndex: number,
    mutateRate: IEngineMutationRates
  ) {
    try {
      const mutant = await this.performMutation(
        individual,
        subProblemIndex,
        mutateRate
      );
      return mutant;
    } catch (error) {
      this.logger.error("Error in mutate");
      this.logger.error(error);
      throw error;
    }
  }

  async getNewSolutions(
    alreadyCreatedSolutions: IEngineSolution[],
    subProblemIndex: number
  ) {
    this.logger.info(`Getting new solutions`);

    this.chat = new ChatOpenAI({
      temperature: IEngineConstants.evolveSolutionsModel.temperature,
      maxTokens: IEngineConstants.evolveSolutionsModel.maxOutputTokens,
      modelName: IEngineConstants.evolveSolutionsModel.name,
      verbose: IEngineConstants.evolveSolutionsModel.verbose,
    });

    let alreadyCreatedSolutionsText;

    if (alreadyCreatedSolutions.length > 0) {
      alreadyCreatedSolutionsText = alreadyCreatedSolutions
        .map((solution) => solution.title)
        .join("\n");
    }

    const textContexts = await this.getTextContext(
      subProblemIndex,
      alreadyCreatedSolutionsText
    );

    this.logger.debug(
      `Evolution Text contexts: ${JSON.stringify(textContexts, null, 2)}`
    );

    const newSolutions = await this.createSolutions(
      subProblemIndex,
      textContexts.general.searchResults,
      textContexts.scientific.searchResults,
      textContexts.openData.searchResults,
      textContexts.news.searchResults,
      alreadyCreatedSolutionsText,
      "evolve-create-population"
    );

    const seedUrls = [
      textContexts.general.selectedUrl,
      textContexts.scientific.selectedUrl,
      textContexts.openData.selectedUrl,
      textContexts.news.selectedUrl,
    ];

    // Go over newSolutions and add selectedUrl
    for (let solution of newSolutions) {
      solution.family = {
        seedUrls,
        gen: this.getNumberOfGenerations(subProblemIndex)
      };
    }

    return newSolutions;
  }

  selectParent(
    population: IEngineSolution[],
    excludedIndividual?: IEngineSolution
  ) {
    const tournamentSize =
      IEngineConstants.evolution.selectParentTournamentSize;

    let tournament = [];
    while (tournament.length < tournamentSize) {
      const randomIndex = Math.floor(Math.random() * population.length);
      if (excludedIndividual && population[randomIndex] === excludedIndividual)
        continue;
      tournament.push(population[randomIndex]);
    }

    tournament.sort((a, b) => b.eloRating! - a.eloRating!);
    return tournament[0];
  }

  getNumberOfGenerations(subProblemIndex: number) {
    return this.memory.subProblems[subProblemIndex].solutions.populations
      .length;
  }

  getPreviousPopulation(subProblemIndex: number) {
    if (!this.memory.subProblems[subProblemIndex].solutions.populations) {
      this.memory.subProblems[subProblemIndex].solutions.populations = [];
    }

    if (
      this.memory.subProblems[subProblemIndex].solutions.populations.length > 0
    ) {
      return this.getActiveSolutionsLastPopulation(subProblemIndex);
    } else {
      this.logger.error("No previous population found." + subProblemIndex);
      throw new Error("No previous population found." + subProblemIndex);
    }
  }

  getIndexOfParent(
    parent: IEngineSolution,
    previousPopulation: IEngineSolution[]
  ): number | undefined {
    return previousPopulation.findIndex((solution) => solution === parent);
  }

  async addRandomMutation(
    newPopulation: IEngineSolution[],
    previousPopulation: IEngineSolution[],
    subProblemIndex: number
  ) {
    const populationSize = IEngineConstants.evolution.populationSize;
    let mutationCount = Math.floor(
      populationSize * IEngineConstants.evolution.mutationOffspringPercent
    );

    if (newPopulation.length + mutationCount > populationSize) {
      mutationCount = populationSize - newPopulation.length;
    }

    this.logger.debug(`Mutation count: ${mutationCount}`);

    for (let i = 0; i < mutationCount; i++) {
      this.logger.debug(`Mutation ${i + 1} of ${mutationCount}`);
      const parent = this.selectParent(previousPopulation);
      this.logger.debug(`Parent: ${parent.title}`);
      try {
        const random = Math.random();
        let mutateRate: IEngineMutationRates;
        if (random < IEngineConstants.evolution.lowMutationRate) {
          mutateRate = "low";
        } else if (
          random <
          IEngineConstants.evolution.lowMutationRate +
            IEngineConstants.evolution.mediumMutationRate
        ) {
          mutateRate = "medium";
        } else {
          mutateRate = "high";
        }
        const mutant = await this.mutate(parent, subProblemIndex, mutateRate);
        mutant.family = {
          parentA: `${
            this.getNumberOfGenerations(subProblemIndex) - 1
          }:${this.getIndexOfParent(parent, previousPopulation)}`,
          mutationRate: mutateRate,
          gen: this.getNumberOfGenerations(subProblemIndex)
        };
        this.logger.debug(`Mutant: ${JSON.stringify(mutant, null, 2)}`);
        newPopulation.push(mutant);
        this.logger.debug("After mutant push");
      } catch (error) {
        this.logger.error("Error in mutation top");
        this.logger.error(error);
        throw error;
      }
    }
  }

  async addCrossover(
    newPopulation: IEngineSolution[],
    previousPopulation: IEngineSolution[],
    subProblemIndex: number
  ) {
    // Crossover
    let crossoverCount = Math.floor(
      IEngineConstants.evolution.populationSize *
        IEngineConstants.evolution.crossoverPercent
    );

    this.logger.debug(`Crossover count: ${crossoverCount}`);

    for (let i = 0; i < crossoverCount; i++) {
      const parentA = this.selectParent(previousPopulation);
      const parentB = this.selectParent(previousPopulation, parentA);

      this.logger.debug(`Parent A: ${parentA.title}`);
      this.logger.debug(`Parent B: ${parentB.title}`);

      let offspring = await this.recombine(parentA, parentB, subProblemIndex);

      let mutationRate: IEngineMutationRates | undefined = undefined;

      if (Math.random() < IEngineConstants.evolution.crossoverMutationPercent) {
        mutationRate = "low";
        offspring = await this.mutate(offspring, subProblemIndex, mutationRate);
      }

      offspring.family = {
        parentA: `${
          this.getNumberOfGenerations(subProblemIndex) - 1
        }:${this.getIndexOfParent(parentA, previousPopulation)}`,
        parentB: `${
          this.getNumberOfGenerations(subProblemIndex) - 1
        }:${this.getIndexOfParent(parentB, previousPopulation)}`,
        mutationRate,
        gen: this.getNumberOfGenerations(subProblemIndex)
      };

      this.logger.debug(`Offspring: ${JSON.stringify(offspring, null, 2)}`);

      newPopulation.push(offspring);
    }
  }

  async addRandomImmigration(
    newPopulation: IEngineSolution[],
    subProblemIndex: number
  ) {
    const populationSize = IEngineConstants.evolution.populationSize;

    let immigrationCount = Math.floor(
      populationSize * IEngineConstants.evolution.randomImmigrationPercent
    );

    this.logger.info(`Immigration count: ${immigrationCount}`);

    if (newPopulation.length + immigrationCount > populationSize) {
      immigrationCount = populationSize - newPopulation.length;
    }

    let newSolutions: IEngineSolution[] = [];

    let allSolutions = [...newPopulation];

    this.logger.debug("Before creating new solutions");

    while (newSolutions.length < immigrationCount) {
      const currentSolutions = await this.getNewSolutions(
        allSolutions,
        subProblemIndex
      );

      this.logger.debug("After getting new solutions");

      newSolutions = [...newSolutions, ...currentSolutions];

      allSolutions = [...allSolutions, ...currentSolutions];

      this.logger.debug(
        `New solutions for population: ${JSON.stringify(newSolutions, null, 2)}`
      );
    }

    if (newSolutions.length > immigrationCount) {
      newSolutions.splice(immigrationCount);
    }

    this.logger.debug("After creating new solutions: " + newSolutions.length);

    newPopulation.push(...newSolutions);
  }

  addUniqueAboveAverageSolutionAsElite(
    previousPopulation: IEngineSolution[],
    newPopulation: IEngineSolution[],
    usedSolutionTitles: Set<string>
  ): void {
    this.logger.debug(`addUniqueAboveAverageSolutionAsElite`);

    const groups = new Map<number, Array<IEngineSolution>>();
    for (let solution of previousPopulation) {
      if (solution.similarityGroup) {
        const groupId = solution.similarityGroup.index;
        if (!groups.has(groupId)) {
          groups.set(groupId, []);
        }
        if (
          solution.eloRating &&
          solution.eloRating >=
            IEngineConstants.evolution.limitTopTopicClusterElitesToEloRating
        ) {
          groups.get(groupId)!.push({ ...solution });
        } else {
          this.logger.debug(
            `Not adding top group solution with lower than average rating: ${solution.title} ${solution.eloRating}`
          );
        }
      }
    }

    // Sorting solutions within each group by eloRating in descending order
    groups.forEach((groupSolutions) => {
      groupSolutions.sort((a, b) => (b.eloRating ?? 0) - (a.eloRating ?? 0));
    });

    for (let [groupId, groupSolutions] of groups) {
      if (groupSolutions.length === 0) {
        this.logger.debug(
          `No solutions above average rating in group ID: ${groupId}`
        );
        continue;
      }

      const bestSolutionInGroup = groupSolutions[0];
      if (!usedSolutionTitles.has(bestSolutionInGroup.title!)) {
        usedSolutionTitles.add(bestSolutionInGroup.title!);
        newPopulation.push(bestSolutionInGroup);
        this.logger.debug(
          `Added solution with unique group ID: ${bestSolutionInGroup.similarityGroup?.index}`
        );
      }
    }
  }

  addElites(
    previousPopulation: IEngineSolution[],
    newPopulation: IEngineSolution[],
    usedSolutionTitles: Set<string>
  ): void {
    this.logger.debug(`Adding elites`);
    const eliteCount = Math.floor(
      previousPopulation.length * IEngineConstants.evolution.keepElitePercent
    );

    this.logger.debug(`Elite count: ${eliteCount}`);

    for (let i = 0; i < eliteCount; i++) {
      if (!usedSolutionTitles.has(previousPopulation[i].title)) {
        usedSolutionTitles.add(previousPopulation[i].title);
        newPopulation.push({ ...previousPopulation[i] });
        this.logger.debug(`Added elite: ${previousPopulation[i].title}`);
      }
    }
  }

  pruneTopicClusters(
    solutions: Array<IEngineSolution>
  ): Array<IEngineSolution> {
    this.logger.info(`Pruning topic clusters ${solutions.length} solutions}`);

    // Group solutions by similarity group
    const groups = new Map<number, Array<IEngineSolution>>();
    for (const solution of solutions) {
      if (solution.similarityGroup) {
        const groupIndex = solution.similarityGroup.index;
        if (!groups.has(groupIndex)) {
          groups.set(groupIndex, []);
        }
        groups.get(groupIndex)!.push(solution);
      }
    }

    // Prune each group and store in a set for faster lookup
    const prunedSolutionSet = new Set<IEngineSolution>();
    for (const group of groups.values()) {
      const prunedGroup = group.slice(
        0,
        IEngineConstants.topItemsToKeepForTopicClusterPruning
      );
      for (const solution of prunedGroup) {
        prunedSolutionSet.add(solution);
      }
    }

    // Build final list of solutions in original order
    const outSolutions = solutions.filter(
      (solution) => !solution.similarityGroup || prunedSolutionSet.has(solution)
    );

    this.logger.info(`Population size after pruning: ${outSolutions.length}`);
    return outSolutions;
  }

  async evolveSubProblem(subProblemIndex: number) {
    this.logger.info(`Evolve population for sub problem ${subProblemIndex}`);
    this.logger.info(
      `Current number of generations: ${this.memory.subProblems[subProblemIndex].solutions.populations.length}`
    );

    let previousPopulation = this.getPreviousPopulation(subProblemIndex);

    this.logger.debug(
      `Previous populations size: ${previousPopulation.length}`
    );

    const newPopulation: IEngineSolution[] = [];

    const usedGroupIds = new Set<number>();
    const usedSolutionTitles = new Set<string>();

    this.addUniqueAboveAverageSolutionAsElite(
      previousPopulation,
      newPopulation,
      usedSolutionTitles
    );

    this.addElites(previousPopulation, newPopulation, usedSolutionTitles);

    previousPopulation = this.pruneTopicClusters(previousPopulation);

    await this.addRandomMutation(
      newPopulation,
      previousPopulation,
      subProblemIndex
    );

    await this.addCrossover(newPopulation, previousPopulation, subProblemIndex);

    await this.addRandomImmigration(newPopulation, subProblemIndex);

    this.logger.info(
      `New population size: ${newPopulation.length} for sub problem ${subProblemIndex}`
    );

    this.memory.subProblems[subProblemIndex].solutions.populations.push(
      newPopulation
    );

    this.logger.debug(
      `Current number of generations after push: ${this.memory.subProblems[subProblemIndex].solutions.populations.length}`
    );

    await this.saveMemory();
  }

  async evolvePopulation() {
    const subProblemPromises = [];
    for (
      let subProblemIndex = 0;
      subProblemIndex <
      Math.min(this.memory.subProblems.length, IEngineConstants.maxSubProblems);
      subProblemIndex++
    ) {
      subProblemPromises.push(this.evolveSubProblem(subProblemIndex));
    }
    await Promise.all(subProblemPromises);
    this.logger.info("Evolve population all complete");
  }

  async process() {
    this.logger.info("Evolve Population Processor");

    try {
      await this.evolvePopulation();
    } catch (error: any) {
      this.logger.error("Error in Evolve Population Processor");
      this.logger.error(error);
      this.logger.error(error.stack);
      throw error;
    }
  }
}
