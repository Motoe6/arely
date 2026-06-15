import { createStore } from "./app-store.js";

export interface UIState {
  sidebarOpen: boolean;
  dashboardOpen: boolean;
  goalsOpen: boolean;
  swarmOpen: boolean;
  paletteOpen: boolean;
  modelSelectorOpen: boolean;
}

export function createDefaultUIState(): UIState {
  return {
    sidebarOpen: true,
    dashboardOpen: false,
    goalsOpen: false,
    swarmOpen: false,
    paletteOpen: false,
    modelSelectorOpen: false,
  };
}

export const uiStore = createStore(createDefaultUIState());
