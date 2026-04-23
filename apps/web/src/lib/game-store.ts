import { PLANET_META, type GameCode, type PlanetCode } from "@mtb/contracts";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { calculateBonusOutcome, type BonusOutcome } from "@/lib/bonus-engine";
import { PLANET_CODE_LABELS, SEGMENT_LABELS } from "@/lib/labels";
import { MINI_GAME_BY_CODE } from "@/lib/mini-games";
import {
  getGameUnlockTarget,
  getPlanetRunUnlockTarget,
  getQuestUnlockTarget,
  INITIAL_UNLOCKED_PLANETS,
  type PlanetUnlockMap,
} from "@/lib/planet-unlocks";

export interface ActionLogItem {
  id: string;
  title: string;
  detail: string;
  reward: number;
  planetCode?: PlanetCode;
  createdAt: string;
}

type StructureMap = Record<PlanetCode, string[]>;
type PlanetMasteryMap = Record<PlanetCode, number>;

interface GameState {
  onboardingComplete: boolean;
  playerAlias: string;
  playerSegment: "student" | "first-jobber" | "freelancer";
  selectedPlanet: PlanetCode;
  stardust: number;
  totalRuns: number;
  bestShieldScore: number;
  bestSocialScore: number;
  bestSnakeScore: number;
  bestGameScores: Partial<Record<GameCode, number>>;
  bonusStreak: number;
  vaultCharge: number;
  vaultCrates: number;
  structures: StructureMap;
  planetMastery: PlanetMasteryMap;
  unlockedPlanets: PlanetUnlockMap;
  actionLog: ActionLogItem[];
  completeOnboarding: (payload: {
    playerAlias: string;
    playerSegment: "student" | "first-jobber" | "freelancer";
    starterPlanet: PlanetCode;
  }) => void;
  selectPlanet: (planetCode: PlanetCode) => void;
  unlockPlanet: (planetCode: PlanetCode, source: string) => boolean;
  buildStructure: (planetCode: PlanetCode, structureId: string, cost: number, title: string) => boolean;
  claimPlanetAction: (payload: {
    planetCode: PlanetCode;
    title: string;
    detail: string;
    baseReward: number;
  }) => BonusOutcome;
  claimQuestReward: (payload: {
    planetCode: PlanetCode;
    questId?: string;
    title: string;
    detail: string;
    baseReward: number;
  }) => BonusOutcome;
  recordSnakeRun: (score: number, baseReward: number) => BonusOutcome;
  recordShieldRun: (score: number, baseReward: number) => BonusOutcome;
  recordSocialRun: (score: number, baseReward: number) => BonusOutcome;
  recordMiniGameRun: (payload: {
    gameCode: GameCode;
    score: number;
    baseReward: number;
    title?: string;
    detail?: string;
  }) => BonusOutcome;
  openBonusCrate: () => number | null;
}

const initialStructures: StructureMap = {
  ORBIT_COMMERCE: [],
  CREDIT_SHIELD: [],
  SOCIAL_RING: [],
};

const initialMastery: PlanetMasteryMap = {
  ORBIT_COMMERCE: 0,
  CREDIT_SHIELD: 0,
  SOCIAL_RING: 0,
};

function createId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function appendActionLog(state: GameState, item: ActionLogItem) {
  return [item, ...state.actionLog].slice(0, 12);
}

function createUnlockLogItem(planetCode: PlanetCode, source: string, createdAt: string): ActionLogItem {
  return {
    id: createId(),
    title: `Открыта планета: ${PLANET_META[planetCode].title}`,
    detail: source,
    reward: 0,
    planetCode,
    createdAt,
  };
}

function appendUnlockToPatch<T extends { actionLog?: ActionLogItem[]; unlockedPlanets?: PlanetUnlockMap }>(
  state: GameState,
  patch: T,
  planetCode: PlanetCode | undefined,
  source: string,
  createdAt: string,
): T {
  if (!planetCode || state.unlockedPlanets[planetCode]) {
    return patch;
  }

  return {
    ...patch,
    unlockedPlanets: {
      ...state.unlockedPlanets,
      ...patch.unlockedPlanets,
      [planetCode]: true,
    },
    actionLog: [createUnlockLogItem(planetCode, source, createdAt), ...(patch.actionLog ?? state.actionLog)].slice(0, 12),
  } as T;
}

export const useGameStore = create<GameState>()(
  persist(
    (set, get) => ({
      onboardingComplete: false,
      playerAlias: "Пилот Моби",
      playerSegment: "student",
      selectedPlanet: "ORBIT_COMMERCE",
      stardust: 24,
      totalRuns: 0,
      bestShieldScore: 0,
      bestSocialScore: 0,
      bestSnakeScore: 0,
      bestGameScores: {},
      bonusStreak: 0,
      vaultCharge: 16,
      vaultCrates: 0,
      structures: initialStructures,
      planetMastery: initialMastery,
      unlockedPlanets: INITIAL_UNLOCKED_PLANETS,
      actionLog: [],
      completeOnboarding: ({ playerAlias, playerSegment }) =>
        set((state) => ({
          onboardingComplete: true,
          playerAlias,
          playerSegment,
          selectedPlanet: "ORBIT_COMMERCE",
          stardust: state.stardust + 10,
          actionLog: appendActionLog(state, {
            id: createId(),
            title: "Вход в MTB Galaxy",
            detail: `${playerAlias} стартовал как ${SEGMENT_LABELS[playerSegment].toLowerCase()} на планете ${PLANET_CODE_LABELS.ORBIT_COMMERCE}.`,
            reward: 10,
            planetCode: "ORBIT_COMMERCE",
            createdAt: new Date().toISOString(),
          }),
        })),
      selectPlanet: (planetCode) => {
        set({ selectedPlanet: planetCode });
      },
      unlockPlanet: (planetCode, source) => {
        const state = get();
        if (state.unlockedPlanets[planetCode]) {
          return false;
        }
        const createdAt = new Date().toISOString();
        set({
          unlockedPlanets: {
            ...state.unlockedPlanets,
            [planetCode]: true,
          },
          actionLog: appendActionLog(state, createUnlockLogItem(planetCode, source, createdAt)),
        });
        return true;
      },
      buildStructure: (planetCode, structureId, cost, title) => {
        const state = get();
        if (!state.unlockedPlanets[planetCode]) {
          return false;
        }
        const built = state.structures[planetCode];
        if (built.includes(structureId) || state.stardust < cost) {
          return false;
        }

        set({
          stardust: state.stardust - cost,
          structures: {
            ...state.structures,
            [planetCode]: [...built, structureId],
          },
          actionLog: appendActionLog(state, {
            id: createId(),
            title: `Построено: ${title}`,
            detail: `Строительство завершено на планете ${PLANET_CODE_LABELS[planetCode]}.`,
            reward: -cost,
            planetCode,
            createdAt: new Date().toISOString(),
          }),
        });
        return true;
      },
      claimPlanetAction: ({ planetCode, title, detail, baseReward }) => {
        const state = get();
        const outcome = calculateBonusOutcome(
          {
            bonusStreak: state.bonusStreak,
            vaultCharge: state.vaultCharge,
            selectedPlanet: state.selectedPlanet,
            structures: state.structures,
            planetMastery: state.planetMastery,
          },
          {
            planetCode,
            baseReward,
            category: "planet_action",
          },
        );
        const createdAt = new Date().toISOString();
        set({
          stardust: state.stardust + outcome.totalReward,
          bonusStreak: outcome.nextStreak,
          vaultCharge: outcome.nextVaultCharge,
          vaultCrates: state.vaultCrates + outcome.cratesEarned,
          planetMastery: {
            ...state.planetMastery,
            [planetCode]: outcome.nextMastery,
          },
          actionLog: appendActionLog(state, {
            id: createId(),
            title,
            detail: `${detail}${outcome.cratesEarned ? ` Контейнер хранилища +${outcome.cratesEarned}.` : ""}`,
            reward: outcome.totalReward,
            planetCode,
            createdAt,
          }),
        });
        return outcome;
      },
      claimQuestReward: ({ planetCode, questId, title, detail, baseReward }) => {
        const state = get();
        const outcome = calculateBonusOutcome(
          {
            bonusStreak: state.bonusStreak,
            vaultCharge: state.vaultCharge,
            selectedPlanet: state.selectedPlanet,
            structures: state.structures,
            planetMastery: state.planetMastery,
          },
          {
            planetCode,
            baseReward,
            category: "quest",
          },
        );
        const createdAt = new Date().toISOString();
        const actionLog = appendActionLog(state, {
          id: createId(),
          title,
          detail: `${detail}${outcome.cratesEarned ? ` Контейнер хранилища +${outcome.cratesEarned}.` : ""}`,
          reward: outcome.totalReward,
          planetCode,
          createdAt,
        });
        const patch = appendUnlockToPatch(
          state,
          {
            stardust: state.stardust + outcome.totalReward,
            bonusStreak: outcome.nextStreak,
            vaultCharge: outcome.nextVaultCharge,
            vaultCrates: state.vaultCrates + outcome.cratesEarned,
            planetMastery: {
              ...state.planetMastery,
              [planetCode]: outcome.nextMastery,
            },
            actionLog,
          },
          getQuestUnlockTarget(questId),
          "Планета открыта после получения награды ключевого квеста.",
          createdAt,
        );
        set(patch);
        return outcome;
      },
      recordSnakeRun: (score, baseReward) => {
        const state = get();
        const outcome = calculateBonusOutcome(
          {
            bonusStreak: state.bonusStreak,
            vaultCharge: state.vaultCharge,
            selectedPlanet: state.selectedPlanet,
            structures: state.structures,
            planetMastery: state.planetMastery,
          },
          {
            planetCode: "ORBIT_COMMERCE",
            baseReward,
            performanceScore: score,
            category: "mini_game",
          },
        );
        const createdAt = new Date().toISOString();
        const actionLog = appendActionLog(state, {
          id: createId(),
          title: "Получена награда Змейки Халва",
          detail: `Забег превращен в орбитальное топливо после ${score} токенов.${outcome.cratesEarned ? ` Контейнер хранилища +${outcome.cratesEarned}.` : ""}`,
          reward: outcome.totalReward,
          planetCode: "ORBIT_COMMERCE",
          createdAt,
        });
        const patch = appendUnlockToPatch(
          state,
          {
            stardust: state.stardust + outcome.totalReward,
            totalRuns: state.totalRuns + 1,
            bestSnakeScore: Math.max(state.bestSnakeScore, score),
            bonusStreak: outcome.nextStreak,
            vaultCharge: outcome.nextVaultCharge,
            vaultCrates: state.vaultCrates + outcome.cratesEarned,
            planetMastery: {
              ...state.planetMastery,
              ORBIT_COMMERCE: outcome.nextMastery,
            },
            actionLog,
          },
          getPlanetRunUnlockTarget("ORBIT_COMMERCE", score),
          "Планета открыта после успешного забега игры Орбиты покупок.",
          createdAt,
        );
        set(patch);
        return outcome;
      },
      recordShieldRun: (score, baseReward) => {
        const state = get();
        const outcome = calculateBonusOutcome(
          {
            bonusStreak: state.bonusStreak,
            vaultCharge: state.vaultCharge,
            selectedPlanet: state.selectedPlanet,
            structures: state.structures,
            planetMastery: state.planetMastery,
          },
          {
            planetCode: "CREDIT_SHIELD",
            baseReward,
            performanceScore: score,
            category: "mini_game",
          },
        );
        const createdAt = new Date().toISOString();
        const actionLog = appendActionLog(state, {
          id: createId(),
          title: "Получена награда Кредитного щита",
          detail: `Управление импульсом стабилизировало щит со счетом ${score}.${outcome.cratesEarned ? ` Контейнер хранилища +${outcome.cratesEarned}.` : ""}`,
          reward: outcome.totalReward,
          planetCode: "CREDIT_SHIELD",
          createdAt,
        });
        const patch = appendUnlockToPatch(
          state,
          {
            stardust: state.stardust + outcome.totalReward,
            totalRuns: state.totalRuns + 1,
            bestShieldScore: Math.max(state.bestShieldScore, score),
            bonusStreak: outcome.nextStreak,
            vaultCharge: outcome.nextVaultCharge,
            vaultCrates: state.vaultCrates + outcome.cratesEarned,
            planetMastery: {
              ...state.planetMastery,
              CREDIT_SHIELD: outcome.nextMastery,
            },
            actionLog,
          },
          getPlanetRunUnlockTarget("CREDIT_SHIELD", score),
          "Планета открыта после успешного забега игры Кредитного щита.",
          createdAt,
        );
        set(patch);
        return outcome;
      },
      recordSocialRun: (score, baseReward) => {
        const state = get();
        const outcome = calculateBonusOutcome(
          {
            bonusStreak: state.bonusStreak,
            vaultCharge: state.vaultCharge,
            selectedPlanet: state.selectedPlanet,
            structures: state.structures,
            planetMastery: state.planetMastery,
          },
          {
            planetCode: "SOCIAL_RING",
            baseReward,
            performanceScore: score,
            category: "mini_game",
          },
        );
        const createdAt = new Date().toISOString();
        set({
          stardust: state.stardust + outcome.totalReward,
          totalRuns: state.totalRuns + 1,
          bestSocialScore: Math.max(state.bestSocialScore, score),
          bonusStreak: outcome.nextStreak,
          vaultCharge: outcome.nextVaultCharge,
          vaultCrates: state.vaultCrates + outcome.cratesEarned,
          planetMastery: {
            ...state.planetMastery,
            SOCIAL_RING: outcome.nextMastery,
          },
          actionLog: appendActionLog(state, {
            id: createId(),
            title: "Получена награда Социального кольца",
            detail: `Сигнальный ринг синхронизировал команду после ${score} точек импульса.${outcome.cratesEarned ? ` Контейнер хранилища +${outcome.cratesEarned}.` : ""}`,
            reward: outcome.totalReward,
            planetCode: "SOCIAL_RING",
            createdAt,
          }),
        });
        return outcome;
      },
      recordMiniGameRun: ({ gameCode, score, baseReward, title, detail }) => {
        const state = get();
        const meta = MINI_GAME_BY_CODE[gameCode];
        const outcome = calculateBonusOutcome(
          {
            bonusStreak: state.bonusStreak,
            vaultCharge: state.vaultCharge,
            selectedPlanet: state.selectedPlanet,
            structures: state.structures,
            planetMastery: state.planetMastery,
          },
          {
            planetCode: meta.planetCode,
            baseReward,
            performanceScore: score,
            category: "mini_game",
          },
        );
        const createdAt = new Date().toISOString();
        const historyTitle = title ?? `Получена награда ${meta.title}`;
        const historyDetail = detail ?? `${meta.title}: счет ${score}.`;
        const actionLog = appendActionLog(state, {
          id: createId(),
          title: historyTitle,
          detail: `${historyDetail}${outcome.cratesEarned ? ` Контейнер хранилища +${outcome.cratesEarned}.` : ""}`,
          reward: outcome.totalReward,
          planetCode: meta.planetCode,
          createdAt,
        });
        const patch = appendUnlockToPatch(
          state,
          {
            stardust: state.stardust + outcome.totalReward,
            totalRuns: state.totalRuns + 1,
            bestGameScores: {
              ...state.bestGameScores,
              [gameCode]: Math.max(state.bestGameScores[gameCode] ?? 0, score),
            },
            bestSnakeScore: gameCode === "halva_snake" ? Math.max(state.bestSnakeScore, score) : state.bestSnakeScore,
            bestShieldScore:
              gameCode === "credit_shield_reactor" ? Math.max(state.bestShieldScore, score) : state.bestShieldScore,
            bestSocialScore:
              gameCode === "social_ring_signal" ? Math.max(state.bestSocialScore, score) : state.bestSocialScore,
            bonusStreak: outcome.nextStreak,
            vaultCharge: outcome.nextVaultCharge,
            vaultCrates: state.vaultCrates + outcome.cratesEarned,
            planetMastery: {
              ...state.planetMastery,
              [meta.planetCode]: outcome.nextMastery,
            },
            actionLog,
          },
          getGameUnlockTarget(gameCode, score),
          `Планета открыта после успешного забега игры ${meta.title}.`,
          createdAt,
        );
        set(patch);
        return outcome;
      },
      openBonusCrate: () => {
        const state = get();
        if (state.vaultCrates <= 0) {
          return null;
        }
        const reward = 14 + Math.floor(Math.random() * 10);
        const createdAt = new Date().toISOString();
        set({
          stardust: state.stardust + reward,
          vaultCrates: state.vaultCrates - 1,
          actionLog: appendActionLog(state, {
            id: createId(),
            title: "Открыт контейнер хранилища",
            detail: "Мгновенная награда выпущена из бонусного хранилища MTB.",
            reward,
            planetCode: state.selectedPlanet,
            createdAt,
          }),
        });
        return reward;
      },
    }),
    {
      name: "mtb-galaxy-game-v1",
      partialize: (state) => ({
        onboardingComplete: state.onboardingComplete,
        playerAlias: state.playerAlias,
        playerSegment: state.playerSegment,
        selectedPlanet: state.selectedPlanet,
        stardust: state.stardust,
        totalRuns: state.totalRuns,
        bestShieldScore: state.bestShieldScore,
        bestSocialScore: state.bestSocialScore,
        bestSnakeScore: state.bestSnakeScore,
        bestGameScores: state.bestGameScores,
        bonusStreak: state.bonusStreak,
        vaultCharge: state.vaultCharge,
        vaultCrates: state.vaultCrates,
        structures: state.structures,
        planetMastery: state.planetMastery,
        unlockedPlanets: state.unlockedPlanets,
        actionLog: state.actionLog,
      }),
    },
  ),
);
