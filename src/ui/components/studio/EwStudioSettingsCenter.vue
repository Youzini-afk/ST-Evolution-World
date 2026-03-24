<template>
  <div class="ew-studio-settings">
    <div class="ew-studio-settings__tabs">
      <button
        type="button"
        class="ew-studio-settings__tab"
        :class="{ active: store.settingsSection === 'connection' }"
        @click="store.setSettingsSection('connection')"
      >
        连接
      </button>
      <button
        type="button"
        class="ew-studio-settings__tab"
        :class="{ active: store.settingsSection === 'workflow' }"
        @click="store.setSettingsSection('workflow')"
      >
        工作流
      </button>
      <button
        type="button"
        class="ew-studio-settings__tab"
        :class="{ active: store.settingsSection === 'interface' }"
        @click="store.setSettingsSection('interface')"
      >
        界面
      </button>
      <button
        type="button"
        class="ew-studio-settings__tab"
        :class="{ active: store.settingsSection === 'help' }"
        @click="store.setSettingsSection('help')"
      >
        帮助
      </button>
    </div>

    <template v-if="store.settingsSection === 'connection'">
      <EwSectionCard
        title="连接设置"
        subtitle="统一管理外部接口预设，供工作流与 Studio 复用。"
      >
        <template #actions>
          <button type="button" class="ew-btn" @click="store.addApiPreset">
            新增API配置
          </button>
        </template>

        <transition-group name="ew-list" tag="div" class="ew-api-list">
          <EwApiPresetCard
            v-for="(preset, index) in store.settings.api_presets"
            :key="preset.id"
            v-memo="[
              preset,
              store.expandedApiPresetId === preset.id,
              bindCountByPresetId[preset.id] ?? 0,
            ]"
            :index="index"
            :model-value="preset"
            :expanded="store.expandedApiPresetId === preset.id"
            :bind-count="bindCountByPresetId[preset.id] ?? 0"
            @toggle-expand="store.toggleApiPresetExpanded(preset.id)"
            @duplicate="store.duplicateApiPreset(preset.id)"
            @remove="store.removeApiPreset(preset.id)"
            @update:model-value="(value) => updateApiPreset(index, value)"
          />
        </transition-group>
      </EwSectionCard>
    </template>

    <template v-else-if="store.settingsSection === 'workflow'">
      <EwSectionCard
        title="工作流默认项"
        subtitle="工作流运行默认项、接管默认项与全局行为。"
      >
        <div class="ew-grid two">
          <EwFieldRow label="总开关" :help="help('enabled')">
            <div class="ew-inline-actions">
              <button
                type="button"
                class="ew-switch"
                role="switch"
                :aria-checked="store.settings.enabled ? 'true' : 'false'"
                @click="store.settings.enabled = !store.settings.enabled"
              >
                <span
                  class="ew-switch__track"
                  :data-enabled="store.settings.enabled ? '1' : '0'"
                >
                  <span class="ew-switch__thumb" />
                </span>
                <span class="ew-switch__text">{{
                  store.settings.enabled ? "已开启" : "已关闭"
                }}</span>
              </button>
              <button
                type="button"
                class="ew-btn ew-btn--sm"
                :disabled="!canRerollCurrentFloor"
                :title="rerollButtonTitle"
                @click="onRerollCurrentFloor()"
              >
                重roll当前楼
              </button>
            </div>
          </EwFieldRow>
          <EwFieldRow label="调度模式" :help="help('dispatch_mode')">
            <select v-model="store.settings.dispatch_mode">
              <option value="parallel">并行</option>
              <option value="serial">串行</option>
            </select>
          </EwFieldRow>
          <EwFieldRow label="总超时(ms)" :help="help('total_timeout_ms')">
            <input
              v-model.number="store.settings.total_timeout_ms"
              type="number"
              min="1000"
              step="500"
            />
          </EwFieldRow>
          <EwFieldRow label="门控时效(ms)" :help="help('gate_ttl_ms')">
            <input
              v-model.number="store.settings.gate_ttl_ms"
              type="number"
              min="1000"
              step="500"
            />
          </EwFieldRow>
          <EwFieldRow
            label="动态条目前缀"
            :help="help('dynamic_entry_prefix')"
          >
            <input
              v-model="store.settings.dynamic_entry_prefix"
              type="text"
              :placeholder="help('dynamic_entry_prefix')?.placeholder"
            />
          </EwFieldRow>
          <EwFieldRow
            label="控制器条目前缀"
            :help="help('controller_entry_prefix')"
          >
            <input
              v-model="store.settings.controller_entry_prefix"
              type="text"
              :placeholder="help('controller_entry_prefix')?.placeholder"
            />
          </EwFieldRow>
        </div>
      </EwSectionCard>

      <EwSectionCard
        v-model="store.globalAdvancedOpen"
        title="高级工作流设置"
        subtitle=""
        collapsible
      >
        <div class="ew-grid two">
          <EwFieldRow label="执行时机" :help="help('workflow_timing')">
            <select v-model="store.settings.workflow_timing">
              <option value="after_reply">回复后更新（默认）</option>
              <option value="before_reply">回复前拦截</option>
            </select>
          </EwFieldRow>
          <EwFieldRow
            label="回复后延迟(秒)"
            :help="help('after_reply_delay_seconds')"
          >
            <input
              v-model.number="store.settings.after_reply_delay_seconds"
              type="number"
              min="0"
              step="0.1"
              :placeholder="help('after_reply_delay_seconds')?.placeholder"
            />
          </EwFieldRow>
          <EwFieldRow label="失败策略" :help="help('failure_policy')">
            <select v-model="store.settings.failure_policy">
              <option value="stop_generation">失败即中止发送</option>
              <option value="continue_generation">静默继续生成</option>
              <option value="retry_once">自动重roll</option>
              <option value="notify_only">仅通知（不中止）</option>
            </select>
          </EwFieldRow>
          <EwFieldRow
            v-if="store.settings.failure_policy === 'retry_once'"
            label="自动重roll次数"
            :help="help('auto_reroll_max_attempts')"
          >
            <input
              v-model.number="store.settings.auto_reroll_max_attempts"
              type="number"
              min="1"
              step="1"
              :placeholder="help('auto_reroll_max_attempts')?.placeholder"
            />
          </EwFieldRow>
          <EwFieldRow
            v-if="store.settings.failure_policy === 'retry_once'"
            label="自动重roll间隔(秒)"
            :help="help('auto_reroll_interval_seconds')"
          >
            <input
              v-model.number="store.settings.auto_reroll_interval_seconds"
              type="number"
              min="0"
              step="0.1"
              :placeholder="help('auto_reroll_interval_seconds')?.placeholder"
            />
          </EwFieldRow>
          <EwFieldRow
            label="并行间隔(秒)"
            :help="help('parallel_dispatch_interval_seconds')"
          >
            <input
              v-model.number="store.settings.parallel_dispatch_interval_seconds"
              type="number"
              min="0"
              step="0.1"
              :placeholder="help('parallel_dispatch_interval_seconds')?.placeholder"
            />
          </EwFieldRow>
          <EwFieldRow
            label="串行间隔(秒)"
            :help="help('serial_dispatch_interval_seconds')"
          >
            <input
              v-model.number="store.settings.serial_dispatch_interval_seconds"
              type="number"
              min="0"
              step="0.1"
              :placeholder="help('serial_dispatch_interval_seconds')?.placeholder"
            />
          </EwFieldRow>
          <EwFieldRow label="重roll范围" :help="help('reroll_scope')">
            <select v-model="store.settings.reroll_scope">
              <option value="all">全部工作流</option>
              <option value="failed_only">仅失败工作流</option>
              <option value="queued_failed">失败队列</option>
            </select>
          </EwFieldRow>
          <EwFieldRow
            label="原消息放行策略"
            :help="help('intercept_release_policy')"
          >
            <select v-model="store.settings.intercept_release_policy">
              <option value="success_only">仅工作流成功时发送原消息</option>
              <option value="always">无论成功失败都发送原消息</option>
              <option value="never">永不自动发送原消息</option>
            </select>
          </EwFieldRow>
          <EwFieldRow label="快照存储方式" :help="help('snapshot_storage')">
            <div style="display: flex; gap: 8px; align-items: center">
              <select v-model="store.settings.snapshot_storage" style="flex: 1">
                <option value="message_data">消息数据（默认）</option>
                <option value="file">服务器文件</option>
              </select>
              <button
                type="button"
                class="ew-btn ew-btn--sm"
                :disabled="migratingSnapshots"
                @click="onMigrateSnapshots()"
              >
                {{ migratingSnapshots ? "同步中…" : "同步快照" }}
              </button>
            </div>
          </EwFieldRow>
        </div>
      </EwSectionCard>

      <div class="ew-flow-scope-tabs">
        <button
          type="button"
          class="ew-flow-scope-tab"
          :class="{ 'ew-flow-scope-tab--active': store.flowScope === 'global' }"
          @click="store.setFlowScope('global')"
        >
          🌐 全局
        </button>
        <button
          type="button"
          class="ew-flow-scope-tab"
          :class="{ 'ew-flow-scope-tab--active': store.flowScope === 'character' }"
          @click="store.setFlowScope('character')"
        >
          🎭 当前角色卡{{ store.activeCharName ? `: ${store.activeCharName}` : "" }}
        </button>
      </div>

      <template v-if="store.flowScope === 'global'">
        <EwSectionCard
          title="全局工作流"
          subtitle="所有角色卡共享的工作流，优先级较低。"
        >
          <template #actions>
            <button type="button" class="ew-btn" @click="store.addFlow">
              新增工作流
            </button>
            <button type="button" class="ew-btn" @click="openFlowImportPicker">
              导入工作流
            </button>
            <button type="button" class="ew-btn" @click="store.exportAllFlows">
              导出全部工作流
            </button>
            <button type="button" class="ew-btn" @click="openWriteToCardModal">
              写入角色卡
            </button>
            <input
              ref="flowImportRef"
              type="file"
              accept=".json,application/json"
              class="ew-hidden-file-input"
              @change="onFlowImportChange"
            />
          </template>

          <transition-group name="ew-list" tag="div" class="ew-flow-list">
            <EwFlowCard
              v-for="(flow, index) in store.settings.flows"
              :key="flow.id"
              v-memo="[
                flow,
                store.expandedFlowId === flow.id,
                store.settings.api_presets,
              ]"
              :index="index"
              :model-value="flow"
              :api-presets="store.settings.api_presets"
              :expanded="store.expandedFlowId === flow.id"
              @toggle-expand="store.toggleFlowExpanded(flow.id)"
              @duplicate="store.duplicateFlow(flow.id)"
              @remove="store.removeFlow(flow.id)"
              @export="store.exportSingleFlow(flow.id)"
              @update:model-value="(value) => updateFlow(index, value)"
            />
          </transition-group>
        </EwSectionCard>
      </template>

      <template v-else>
        <EwSectionCard
          :title="
            '角色卡工作流' +
            (store.activeCharName ? ` — ${store.activeCharName}` : '')
          "
          subtitle="仅在当前角色卡生效的工作流，随角色卡导出/导入。优先级高于全局。"
        >
          <template #actions>
            <button type="button" class="ew-btn" @click="store.addCharFlow">
              新增工作流
            </button>
            <button type="button" class="ew-btn" @click="store.saveCharFlows">
              💾 保存到世界书
            </button>
            <button type="button" class="ew-btn" @click="store.loadCharFlows">
              刷新
            </button>
          </template>

          <div v-if="store.charFlowsLoading" class="ew-flow-loading">
            加载角色卡工作流中...
          </div>

          <transition-group
            v-else
            name="ew-list"
            tag="div"
            class="ew-flow-list"
          >
            <EwFlowCard
              v-for="(flow, index) in store.charFlows"
              :key="flow.id"
              v-memo="[
                flow,
                store.expandedFlowId === flow.id,
                store.settings.api_presets,
              ]"
              :index="index"
              :model-value="flow"
              :api-presets="store.settings.api_presets"
              :expanded="store.expandedFlowId === flow.id"
              @toggle-expand="store.toggleFlowExpanded(flow.id)"
              @duplicate="store.duplicateCharFlow(flow.id)"
              @remove="store.removeCharFlow(flow.id)"
              @update:model-value="(value) => updateCharFlow(index, value)"
            />
          </transition-group>
        </EwSectionCard>
      </template>
    </template>

    <template v-else-if="store.settingsSection === 'interface'">
      <EwSectionCard title="界面偏好" subtitle="控制 Studio 的视觉和入口偏好。">
        <div class="ew-grid two">
          <EwFieldRow label="月相主题">
            <button
              type="button"
              class="ew-switch"
              role="switch"
              :aria-checked="store.settings.theme_moon ? 'true' : 'false'"
              @click="store.settings.theme_moon = !store.settings.theme_moon"
            >
              <span
                class="ew-switch__track"
                :data-enabled="store.settings.theme_moon ? '1' : '0'"
              >
                <span class="ew-switch__thumb" />
              </span>
              <span class="ew-switch__text">{{
                store.settings.theme_moon ? "已开启" : "已关闭"
              }}</span>
            </button>
          </EwFieldRow>
          <EwFieldRow label="悬浮球">
            <label
              style="
                display: flex;
                align-items: center;
                gap: 8px;
                cursor: pointer;
              "
            >
              <input
                v-model="store.settings.show_fab"
                type="checkbox"
                @change="emitFabChanged()"
              />
              显示悬浮球入口
            </label>
          </EwFieldRow>
        </div>
      </EwSectionCard>

      <EwSectionCard
        title="界面渲染与隐藏"
        subtitle="控制楼层隐藏和界面渲染数量。"
      >
        <div class="ew-grid two">
          <EwFieldRow label="隐藏楼层">
            <button
              type="button"
              class="ew-switch"
              role="switch"
              :aria-checked="store.settings.hide_settings.enabled ? 'true' : 'false'"
              @click="
                store.settings.hide_settings.enabled =
                  !store.settings.hide_settings.enabled
              "
            >
              <span
                class="ew-switch__track"
                :data-enabled="store.settings.hide_settings.enabled ? '1' : '0'"
              >
                <span class="ew-switch__thumb" />
              </span>
              <span class="ew-switch__text">{{
                store.settings.hide_settings.enabled ? "已开启" : "已关闭"
              }}</span>
            </button>
          </EwFieldRow>
          <EwFieldRow label="保留最新 N 条">
            <input
              v-model.number="store.settings.hide_settings.hide_last_n"
              type="number"
              min="0"
              step="1"
              placeholder="0 表示不隐藏"
              :disabled="!store.settings.hide_settings.enabled"
            />
          </EwFieldRow>
          <EwFieldRow label="限制楼层渲染">
            <button
              type="button"
              class="ew-switch"
              role="switch"
              :aria-checked="
                store.settings.hide_settings.limiter_enabled ? 'true' : 'false'
              "
              @click="
                store.settings.hide_settings.limiter_enabled =
                  !store.settings.hide_settings.limiter_enabled
              "
            >
              <span
                class="ew-switch__track"
                :data-enabled="
                  store.settings.hide_settings.limiter_enabled ? '1' : '0'
                "
              >
                <span class="ew-switch__thumb" />
              </span>
              <span class="ew-switch__text">{{
                store.settings.hide_settings.limiter_enabled
                  ? "已开启"
                  : "已关闭"
              }}</span>
            </button>
          </EwFieldRow>
          <EwFieldRow label="仅渲染最新 M 条">
            <input
              v-model.number="store.settings.hide_settings.limiter_count"
              type="number"
              min="1"
              step="1"
              placeholder="例如 20"
              :disabled="!store.settings.hide_settings.limiter_enabled"
            />
          </EwFieldRow>
        </div>
        <div class="ew-actions-wrap" style="margin-top: 0.75rem">
          <button type="button" class="ew-btn" @click="onApplyHide">
            立即应用隐藏
          </button>
          <button type="button" class="ew-btn ew-btn--danger" @click="onUnhideAll">
            取消全部隐藏
          </button>
        </div>
      </EwSectionCard>
    </template>

    <template v-else>
      <EwSectionCard
        title="Studio 概览"
        subtitle="设置中心汇总当前环境、Graph Bridge 与配置规模。"
      >
        <div class="ew-summary-grid">
          <article class="ew-summary-card">
            <h4>工作流数量</h4>
            <strong>{{ store.settings.flows.length }}</strong>
            <small>总工作流</small>
          </article>
          <article class="ew-summary-card">
            <h4>已启用</h4>
            <strong>{{ enabledFlowCount }}</strong>
            <small>活跃工作流</small>
          </article>
          <article class="ew-summary-card">
            <h4>API预设</h4>
            <strong>{{ store.settings.api_presets.length }}</strong>
            <small>接口配置</small>
          </article>
          <article
            v-if="store.activeGraphBridgeIntentSummary"
            class="ew-summary-card"
          >
            <h4>Graph Bridge</h4>
            <strong>{{
              store.activeGraphBridgeIntentSummary.route === "graph"
                ? store.activeGraphBridgeIntentSummary.graphIntentLabel
                : store.activeGraphBridgeIntentSummary.reasonLabel
            }}</strong>
            <small>
              {{ store.activeGraphBridgeIntentSummary.routeLabel }} ·
              {{ store.activeGraphBridgeIntentSummary.reasonLabel }}
            </small>
          </article>
        </div>
      </EwSectionCard>

      <EwSectionCard
        title="环境与帮助"
        subtitle="当前环境检查与 Studio 四入口说明。"
      >
        <div class="ew-summary-grid">
          <article class="ew-summary-card ew-summary-card--env">
            <h4>环境检查</h4>
            <strong>{{ environmentStatus.overallLabel }}</strong>
            <div class="ew-summary-badges">
              <span
                class="ew-status-pill"
                :data-tone="environmentStatus.promptTemplateTone"
              >
                模板 {{ environmentStatus.promptTemplateLabel }}
              </span>
              <span
                class="ew-status-pill"
                :data-tone="environmentStatus.ewEjsTone"
              >
                EW EJS {{ environmentStatus.ewEjsLabel }}
              </span>
            </div>
            <small>{{ environmentStatus.overallDetail }}</small>
          </article>
          <article class="ew-summary-card">
            <h4>设置</h4>
            <small>连接、工作流默认项、界面偏好与帮助。</small>
          </article>
          <article class="ew-summary-card">
            <h4>资产</h4>
            <small>模板与统一构件体系的发现、预览与创建前决策。</small>
          </article>
          <article class="ew-summary-card">
            <h4>编辑 / 观测</h4>
            <small>编辑器负责创作，观测负责当前工作流运行观察。</small>
          </article>
        </div>
      </EwSectionCard>
    </template>

    <transition name="ew-modal">
      <div
        v-if="showWriteToCardModal"
        class="ew-modal-overlay"
        @click.self="showWriteToCardModal = false"
      >
        <div class="ew-modal ew-modal--write-card">
          <header class="ew-modal__header">
            <h3>选择要写入角色卡的工作流</h3>
            <button
              type="button"
              class="ew-modal__close"
              @click="showWriteToCardModal = false"
            >
              ✕
            </button>
          </header>
          <div class="ew-modal__body">
            <p class="ew-modal__hint">
              同名工作流将更新，新工作流将追加。已有角色卡工作流不受影响。
            </p>
            <label class="ew-write-card-item ew-write-card-item--all">
              <input
                type="checkbox"
                :checked="writeToCardSelection.size === store.settings.flows.length"
                :indeterminate="
                  writeToCardSelection.size > 0 &&
                  writeToCardSelection.size < store.settings.flows.length
                "
                @change="toggleWriteToCardSelectAll"
              />
              <span>全选 / 取消全选</span>
            </label>
            <div class="ew-write-card-list">
              <label
                v-for="flow in store.settings.flows"
                :key="flow.id"
                class="ew-write-card-item"
              >
                <input
                  type="checkbox"
                  :checked="writeToCardSelection.has(flow.id)"
                  @change="toggleWriteToCardItem(flow.id)"
                />
                <span>{{ flow.name || flow.id }}</span>
              </label>
            </div>
          </div>
          <footer class="ew-modal__footer">
            <button
              type="button"
              class="ew-btn"
              :disabled="writeToCardBusy || writeToCardSelection.size === 0"
              @click="confirmWriteToCard"
            >
              {{ writeToCardBusy ? "写入中…" : "写入角色卡" }}
            </button>
          </footer>
        </div>
      </div>
    </transition>
  </div>
</template>

<script setup lang="ts">
import type { EwApiPreset, EwFlowConfig } from "../../../runtime/types";
import EwApiPresetCard from "../EwApiPresetCard.vue";
import EwFieldRow from "../EwFieldRow.vue";
import EwFlowCard from "../EwFlowCard.vue";
import EwSectionCard from "../EwSectionCard.vue";
import { getFieldHelp } from "../../help-meta";
import { showEwNotice } from "../../notice";
import { useEwStore } from "../../store";
import {
  applyFloorLimit,
  runFullHideCheck,
  unhideAll,
} from "../../../runtime/hide-engine";

interface EnvironmentStatus {
  overallLabel: string;
  overallDetail: string;
  promptTemplateLabel: string;
  promptTemplateTone: "good" | "warn" | "bad" | "muted";
  ewEjsLabel: string;
  ewEjsTone: "good" | "warn" | "bad" | "muted";
}

const props = defineProps<{
  environmentStatus: EnvironmentStatus;
  canRerollCurrentFloor: boolean;
  rerollButtonTitle: string;
  bindCountByPresetId: Record<string, number>;
  migratingSnapshots: boolean;
  emitFabChanged: () => void;
  onMigrateSnapshots: () => void | Promise<void>;
  onRerollCurrentFloor: () => void | Promise<void>;
  updateApiPreset: (index: number, nextPreset: EwApiPreset) => void;
  updateFlow: (index: number, nextFlow: EwFlowConfig) => void;
  updateCharFlow: (index: number, nextFlow: EwFlowConfig) => void;
}>();

const store = useEwStore();
const flowImportRef = ref<HTMLInputElement | null>(null);
const showWriteToCardModal = ref(false);
const writeToCardSelection = ref<Set<string>>(new Set());
const writeToCardBusy = ref(false);

function help(key: string) {
  return getFieldHelp(key);
}

function openFlowImportPicker() {
  flowImportRef.value?.click();
}

async function onFlowImportChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    store.importFlowsFromText(text, file.name);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showEwNotice({
      title: "工作流导入失败",
      message,
      level: "error",
      duration_ms: 4800,
    });
  } finally {
    if (input) {
      input.value = "";
    }
  }
}

function onApplyHide() {
  runFullHideCheck(store.settings.hide_settings);
  applyFloorLimit(store.settings.hide_settings);
  showEwNotice({
    title: "隐藏助手",
    message: "隐藏设置已应用",
    level: "success",
  });
}

function onUnhideAll() {
  store.settings.hide_settings.hide_last_n = 0;
  unhideAll();
  showEwNotice({
    title: "隐藏助手",
    message: "已取消全部隐藏",
    level: "info",
  });
}

function openWriteToCardModal() {
  writeToCardSelection.value = new Set(
    store.settings.flows.filter((flow) => flow.enabled).map((flow) => flow.id),
  );
  showWriteToCardModal.value = true;
}

function toggleWriteToCardSelectAll() {
  if (writeToCardSelection.value.size === store.settings.flows.length) {
    writeToCardSelection.value = new Set();
  } else {
    writeToCardSelection.value = new Set(store.settings.flows.map((flow) => flow.id));
  }
}

function toggleWriteToCardItem(flowId: string) {
  const next = new Set(writeToCardSelection.value);
  if (next.has(flowId)) {
    next.delete(flowId);
  } else {
    next.add(flowId);
  }
  writeToCardSelection.value = next;
}

async function confirmWriteToCard() {
  writeToCardBusy.value = true;
  try {
    await store.mergeFlowsToCard([...writeToCardSelection.value]);
    showWriteToCardModal.value = false;
  } finally {
    writeToCardBusy.value = false;
  }
}

const enabledFlowCount = computed(
  () => store.settings.flows.filter((flow) => flow.enabled).length,
);
</script>

<style scoped>
.ew-studio-settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ew-studio-settings__tabs {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}

.ew-studio-settings__tab {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.7);
  border-radius: 999px;
  padding: 8px 14px;
  cursor: pointer;
}

.ew-studio-settings__tab.active {
  background: rgba(99, 102, 241, 0.18);
  border-color: rgba(99, 102, 241, 0.36);
  color: rgba(255, 255, 255, 0.94);
}

.ew-grid.two {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.ew-inline-actions,
.ew-actions-wrap,
.ew-summary-badges,
.ew-flow-scope-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.ew-api-list,
.ew-flow-list,
.ew-write-card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ew-btn,
.ew-flow-scope-tab {
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.9);
  border-radius: 12px;
  padding: 8px 12px;
  cursor: pointer;
}

.ew-btn--danger {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.28);
}

.ew-switch {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.88);
  cursor: pointer;
  padding: 0;
}

.ew-switch__track {
  width: 42px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.08);
  display: inline-flex;
  align-items: center;
  padding: 2px;
}

.ew-switch__track[data-enabled="1"] {
  background: rgba(16, 185, 129, 0.3);
  border-color: rgba(16, 185, 129, 0.38);
}

.ew-switch__thumb {
  width: 18px;
  height: 18px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.94);
  transform: translateX(0);
  transition: transform 0.2s ease;
}

.ew-switch__track[data-enabled="1"] .ew-switch__thumb {
  transform: translateX(18px);
}

.ew-switch__text {
  font-size: 12px;
}

.ew-flow-scope-tab--active {
  background: rgba(99, 102, 241, 0.18);
  border-color: rgba(99, 102, 241, 0.36);
}

.ew-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.ew-summary-card {
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ew-summary-card h4,
.ew-summary-card strong,
.ew-summary-card small {
  margin: 0;
}

.ew-summary-card h4,
.ew-summary-card small {
  color: rgba(255, 255, 255, 0.64);
}

.ew-summary-card strong {
  color: rgba(255, 255, 255, 0.94);
}

.ew-status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  border-radius: 999px;
  padding: 0 8px;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.88);
}

.ew-status-pill[data-tone="good"] {
  background: rgba(16, 185, 129, 0.2);
  color: #d1fae5;
}

.ew-status-pill[data-tone="warn"] {
  background: rgba(245, 158, 11, 0.2);
  color: #fde68a;
}

.ew-status-pill[data-tone="bad"] {
  background: rgba(239, 68, 68, 0.2);
  color: #fecaca;
}

.ew-hidden-file-input {
  display: none;
}

.ew-flow-loading,
.ew-flow-empty {
  color: rgba(255, 255, 255, 0.64);
  font-size: 12px;
  line-height: 1.6;
}

.ew-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(4, 7, 16, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.ew-modal {
  width: min(560px, calc(100vw - 32px));
  border-radius: 18px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(8, 12, 24, 0.96);
  display: flex;
  flex-direction: column;
}

.ew-modal__header,
.ew-modal__footer {
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ew-modal__body {
  padding: 0 16px 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ew-modal__close {
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.76);
  cursor: pointer;
}

.ew-modal__hint,
.ew-write-card-item span {
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  line-height: 1.6;
}

.ew-write-card-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

@media (max-width: 980px) {
  .ew-grid.two,
  .ew-summary-grid {
    grid-template-columns: 1fr;
  }
}
</style>
