import { css, html, nothing } from 'lit';
import { property, customElement } from 'lit/decorators.js';
import './@yrpri/common/yp-image.js';
import { CpsStageBase } from './cps-stage-base.js';

import '@material/web/chips/chip-set.js';
import '@material/web/chips/filter-chip.js';
import '@material/web/iconbutton/standard-icon-button.js';
import '@material/web/select/outlined-select.js';
import '@material/web/select/select-option.js';
import '@material/web/iconbutton/outlined-icon-button.js';
import '@material/web/chips/input-chip.js';

import { MdOutlinedSelect } from '@material/web/select/outlined-select.js';

@customElement('cps-solutions')
export class CpsSolutions extends CpsStageBase {
  @property({ type: Boolean }) isDropdownVisible = false;
  @property({ type: String }) searchText = '';

  async connectedCallback() {
    super.connectedCallback();
    window.appGlobals.activity(`Solutions - open`);
  }

  updated(changedProperties: Map<string | number | symbol, unknown>): void {
    super.updated(changedProperties);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.appGlobals.activity(`Solutions - close`);
  }

  static get styles() {
    return [
      super.styles,
      css`
        md-outlined-icon-button {
          margin-left: 8px;
          margin-right: 8px;
          margin-top: -4px;
        }

        md-outlined-select {
          margin-top: -12px;
          margin-left: 8px;
          margin-right: 8px;
        }

        .generations {
          margin-top: 16px;
          margin-bottom: 16px;
          max-width: 1024px;
        }

        md-filter-chip {
          margin-bottom: 8px;
        }

        md-filter-chip[more-than-seven-items] {
          margin-bottom: 8px;
          width: 134px;
        }

        .title {
          margin-top: 4px;
        }

        .solutionItem {
          text-align: left;
          background-color: var(--md-sys-color-on-secondary);
          color: var(--md-sys-color-secondary);
          border-radius: 16px;
          padding: 20px;
          margin: 8px 0;
          max-width: 960px;
          width: 100%;
          font-size: 22px;
          height: 52px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: left;
          cursor: pointer;
          line-height: 1.4;
          vertical-align: middle;
        }

        .generationContainer {
          width: 100%;
        }


        .solution {
          text-align: left;
          background-color: var(--md-sys-color-on-primary);
          color: var(--md-sys-color-primary);
          border-radius: 16px;
          padding: 16px;
          margin: 8px 0;
          max-width: 960px;
          width: 100%;
        }

        .proCon {
          margin: 8px;
          padding: 24px;
          max-width: 410px;
          width: 100%;
          background-color: var(--md-sys-color-on-tertiary);
          color: var(--md-sys-color-tertiary);
          border-radius: 16px;
          font-size: 20px;
          align-items: self-start;
          line-height: 1.4;
        }

        .prosConsHeader {
          font-size: 24px;
          color: var(--md-sys-color-tertiary);
          font-weight: 500;
          margin-bottom: 8px;
        }

        .solutionTitle {
          font-size: 24px;
          font-weight: 700;
          letter-spacing: 0.1em;
          line-height: 1.4;
          margin: 8px;
        }

        .solutionDescription {
          padding: 8px;
          font-size: 22px;
          line-height: 1.4;
        }

        .solutionAttributes {
          display: flex;
          justify-content: space-between;
          align-items: self-start;
        }

        .pros,
        .cons {
          width: 45%;
          padding: 10px;
          margin: 10px 0;
        }

        @media (max-width: 600px) {
          .solutionAttributes {
            flex-direction: column;
          }
        }
      `,
    ];
  }

  get filteredSolutions() {
    let subProblem = this.memory.subProblems[this.activeSubProblemIndex];
    let solutions = subProblem.solutions.populations[this.activePopulationIndex];

    if (this.searchText) {
      solutions = solutions.filter(solution =>
        solution.title.includes(this.searchText) ||
        solution.description.includes(this.searchText)
      );
    }

    return solutions;
  }

  render() {
    const subProblems = this.memory.subProblems || [];
    if (this.activeSolutionIndex !== null) {
      return this.renderSolutionScreen(this.activeSolutionIndex);
    } else if (this.activeSubProblemIndex !== null) {
      return this.renderSubProblemScreen(
        subProblems[this.activeSubProblemIndex]
      );
    } else {
      return this.renderSubProblemList(
        subProblems,
        this.t('Sub problems and Solutions')
      );
    }
  }

  renderSubProblemScreen(subProblem: IEngineSubProblem) {
    return html`
      <div class="topContainer layout vertical center-center">
        ${this.renderSubProblem(subProblem, false, 0, true, true)}
        <div class="title">${this.t('Evolving Solutions')}</div>
        <div class="generationContainer layout vertical center-center">
          ${this.renderChipSet(subProblem)}
          ${this.filteredSolutions.map(
            (solution, index) =>
              html`<div
                class="solutionItem"
                @click="${(): void => {
                  this.activeSolutionIndex = index;
                  window.scrollTo(0, 0);
                }}"
              >
                ${index + 1}. ${solution.title}
              </div>`
          )}
        </div>
      </div>
    `;
  }

  renderChipSet(subProblem: IEngineSubProblem) {
    let firstItems = subProblem.solutions.populations.slice(0, 3);
    let lastItems = subProblem.solutions.populations.slice(-3);
    let middleItems = subProblem.solutions.populations.slice(3, -3);

    if (subProblem.solutions.populations.length === 7) {
      middleItems = subProblem.solutions.populations.slice(3, 4);
    }

    return html`
      <md-chip-set
        class="generations layout horizontal wrap"
        type="filter"
        single-select
      >
        ${this.renderFilterChips(firstItems, 0)}
        ${this.renderDropdown(middleItems, firstItems.length)}
        ${this.renderFilterChips(
          lastItems,
          subProblem.solutions.populations.length - 3
        )}
         <md-input-chip
          .label="${this.t('Search')}"
          value=${this.searchText}
          @change=${(e: Event) => this.searchText = (e.target as HTMLInputElement).value}
        ></md-input-chip>
      </md-chip-set>
    `;
  }

  renderFilterChips(items: IEngineSolution[][], startIndex: number) {
    return items.map(
      (population, index) =>
        html`<md-filter-chip
          class="layout horizontal center-center"
          ?more-than-seven-items="${items.length > 7}"
          label="Generation ${startIndex + index + 1}"
          .selected="${this.activePopulationIndex === startIndex + index}"
          @click="${() => {
            this.activePopulationIndex = startIndex + index;
            this.resetDropdown();
          }}"
        ></md-filter-chip> `
    );
  }

  handleDropdownChange(e: Event) {
    const selectElement = e.target as HTMLSelectElement;
    this.activePopulationIndex = Number(selectElement.value) - 1;
  }

  async toggleDropdownVisibility(): Promise<void> {
    this.isDropdownVisible = !this.isDropdownVisible;
    if (this.isDropdownVisible) {
      await this.updateComplete;
      const dropdown = this.shadowRoot.querySelector(
        'md-outlined-select'
      ) as MdOutlinedSelect;
      if (dropdown) {
        dropdown.selectedIndex = 0;
        this.activePopulationIndex = 3;
      }
    }
  }

  resetDropdown() {
    const dropdown = this.shadowRoot.querySelector(
      'md-outlined-select'
    ) as MdOutlinedSelect;
    if (dropdown) {
      this.isDropdownVisible = false;
    }
  }

  renderDropdown(middleItems: IEngineSolution[][], startIndex: number) {
    if (middleItems.length > 0 && !this.isDropdownVisible) {
      return html`
        <md-outlined-icon-button @click="${this.toggleDropdownVisibility}">
          <md-icon>expand_more</md-icon>
        </md-outlined-icon-button>
      `;
    } else if (middleItems.length > 0 && this.isDropdownVisible) {
      return html`
        <md-outlined-select
          label="Generation ..."
          .quick=${true}
          .required=${false}
          .disabled=${false}
          @change=${(e: Event) => this.handleDropdownChange(e)}
        >
          ${middleItems.map(
            (population, index) =>
              html`<md-select-option
                .value="${(startIndex + index + 1).toString()}"
                .headline="Generation ${startIndex + index + 1}"
              ></md-select-option>`
          )}
        </md-outlined-select>
      `;
    } else {
      return nothing;
    }
  }

  renderSolutionScreen(solutionIndex: number) {
    const solutions = this.filteredSolutions;
    const solution = solutions[solutionIndex];
    return html`
      <div class="topContainer layout vertical center-center">
        <div class="layout horizontal center-center">
          <md-standard-icon-button
            aria-label="Previous"
            .disabled="${solutionIndex === 0}"
            @click="${(): void => {
              if (solutionIndex > 0) {
                this.activeSolutionIndex = solutionIndex - 1;
              }
            }}"
          >
            <md-icon>navigate_before</md-icon>
          </md-standard-icon-button>
          <md-standard-icon-button
            aria-label="Next"
            .disabled="${solutionIndex === solutions.length - 1}"
            @click="${(): void => {
              if (solutionIndex < solutions.length - 1) {
                this.activeSolutionIndex = solutionIndex + 1;
              }
            }}"
          >
            <md-icon>navigate_next</md-icon>
          </md-standard-icon-button>
          <md-standard-icon-button
            aria-label="Close"
            @click="${(): void => (this.activeSolutionIndex = null)}"
          >
            <md-icon>close</md-icon>
          </md-standard-icon-button>
        </div>
        <div class="solution">
          <div class="solutionTitle">
            ${solutionIndex + 1}. ${solution.title}
          </div>
          <div class="solutionDescription">${solution.description}</div>
          <div class="solutionDescription">
            ${solution.mainBenefitOfSolution}
          </div>
          <div class="solutionDescription">
            ${solution.mainObstacleToSolutionAdoption}
          </div>
        </div>
        <div class="prosCons">
          <div class="solutionAttributes layout horizontal wrap">
            <div class="pros flexFactor layout vertical center-center">
              <div class="prosConsHeader">${this.t('Pros')}</div>
              ${(solution.pros as IEngineProCon[])?.map(
                pro => html`<div class="proCon">${pro.description}</div>`
              )}
            </div>
            <div class="cons flexFactor layout vertical center-center">
              <div class="prosConsHeader">${this.t('Cons')}</div>
              ${(solution.cons as IEngineProCon[])?.map(
                con => html`<div class="proCon">${con.description}</div>`
              )}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
