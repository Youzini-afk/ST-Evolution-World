<template>
  <div class="ew-builder-workbench">
    <div class="ew-builder-workbench__topbar">
      <div class="ew-builder-workbench__tabs">
        <button
          v-for="(graph, index) in localGraphs"
          :key="graph.id"
          class="ew-builder-workbench__tab"
          :class="{ active: activeGraphId === graph.id }"
          @click="activeGraphId = graph.id"
        >
          {{ graph.name || `图 ${index + 1}` }}
        </button>
        <button
          class="ew-builder-workbench__tab ew-builder-workbench__tab--add"
          @click="addGraph"
          title="新增图"
        >
          +
        </button>
      </div>
      <div class="ew-builder-workbench__controls">
        <div class="ew-builder-workbench__mode-switch">
          <button
            class="ew-builder-workbench__mode-btn"
            :class="{ active: currentBuilderMode === 'simple' }"
            @click="setBuilderMode('simple')"
          >
            Simple
          </button>
          <button
            class="ew-builder-workbench__mode-btn"
            :class="{ active: currentBuilderMode === 'advanced' }"
            @click="setBuilderMode('advanced')"
          >
            Advanced
          </button>
        </div>
        <button
          class="ew-builder-workbench__ctrl-btn"
          :class="{ active: templateLibraryOpen }"
          :title="templateLibraryOpen ? '收起模板库' : '展开模板库'"
          @click="templateLibraryOpen = !templateLibraryOpen"
        >
          ◫
        </button>
        <button
          class="ew-builder-workbench__ctrl-btn"
          :disabled="!activeGraph"
          title="重命名当前图"
          @click="renameGraph"
        >
          ✏️
        </button>
        <button
          class="ew-builder-workbench__ctrl-btn"
          :disabled="!activeGraph"
          :title="activeGraph?.enabled ? '禁用当前图' : '启用当前图'"
          @click="toggleEnabled"
        >
          {{ activeGraph?.enabled ? "🟢" : "⚫" }}
        </button>
        <button
          class="ew-builder-workbench__ctrl-btn"
          :disabled="currentBuilderMode !== 'advanced'"
          :class="{ active: advancedSidebarOpen }"
          :title="advancedSidebarOpen ? '收起高级侧栏' : '展开高级侧栏'"
          @click="advancedSidebarOpen = !advancedSidebarOpen"
        >
          ⫶
        </button>
      </div>
    </div>

    <section
      v-if="showTemplateLibrary"
      class="ew-builder-workbench__starter"
    >
      <div class="ew-builder-workbench__starter-header">
        <div>
          <div class="ew-builder-workbench__eyebrow">Builder First</div>
          <h3 class="ew-builder-workbench__title">从模板开始</h3>
        </div>
        <p class="ew-builder-workbench__starter-copy">
          先用较大颗粒的起步图把工作流跑起来，再进入底层图继续改。
        </p>
      </div>
      <div class="ew-builder-workbench__template-grid">
        <article
          v-for="template in builderTemplates"
          :key="template.id"
          class="ew-builder-workbench__template-card"
          :data-ownership="template.ownership"
        >
          <div class="ew-builder-workbench__chips">
            <span class="ew-builder-workbench__chip">
              {{ formatOwnership(template.ownership) }}
            </span>
            <span class="ew-builder-workbench__chip">
              {{ formatBuilderMode(template.recommendedBuilderMode) }}
            </span>
            <span class="ew-builder-workbench__chip">
              {{ formatTiming(template.timing) }}
            </span>
          </div>
          <h4 class="ew-builder-workbench__template-title">
            {{ template.label }}
          </h4>
          <p class="ew-builder-workbench__template-summary">
            {{ template.summary }}
          </p>
          <p class="ew-builder-workbench__template-description">
            {{ template.description }}
          </p>
          <div class="ew-builder-workbench__template-tags">
            <span
              v-for="tag in template.tags"
              :key="`${template.id}-${tag}`"
              class="ew-builder-workbench__template-tag"
            >
              {{ tag }}
            </span>
          </div>
          <button
            class="ew-builder-workbench__template-action"
            @click="createGraphFromTemplate(template.id)"
          >
            {{ replaceEmptyGraph ? "套用到当前空图" : "新建模板图" }}
          </button>
        </article>
      </div>
    </section>

    <section
      v-if="compositePackages.length > 0"
      class="ew-builder-workbench__packages"
    >
      <div class="ew-builder-workbench__starter-header">
        <div>
          <div class="ew-builder-workbench__eyebrow">Packages / Fragments</div>
          <h3 class="ew-builder-workbench__title">大颗粒积木与可复用子图</h3>
        </div>
        <p class="ew-builder-workbench__starter-copy">
          package 适合大颗粒起步，fragment 更适合插入到现有链路里做内联复用；两者都会直接展开成真实子图。
        </p>
      </div>
      <div class="ew-builder-workbench__package-grid">
        <article
          v-for="pkg in compositePackages"
          :key="pkg.moduleId"
          class="ew-builder-workbench__package-card"
        >
          <div class="ew-builder-workbench__chips">
            <span class="ew-builder-workbench__chip">
              {{ formatCompositeKind(pkg) }}
            </span>
            <span class="ew-builder-workbench__chip">{{ pkg.category }}</span>
            <span
              v-if="getCompositeRetryReasonLabel(pkg.moduleId)"
              class="ew-builder-workbench__chip"
            >
              {{ getCompositeRetryReasonLabel(pkg.moduleId) }}
            </span>
          </div>
          <h4 class="ew-builder-workbench__template-title">
            {{ pkg.label }}
          </h4>
          <p class="ew-builder-workbench__template-summary">
            {{ pkg.description }}
          </p>

          <div
            v-if="(pkg.configSchema?.length ?? 0) > 0"
            class="ew-builder-workbench__package-fields"
          >
            <label
              v-for="field in pkg.configSchema ?? []"
              :key="`${pkg.moduleId}-${field.key}`"
              class="ew-builder-workbench__field"
            >
              <span class="ew-builder-workbench__field-label">
                {{ field.label }}
              </span>
              <button
                v-if="field.type === 'boolean'"
                type="button"
                class="ew-builder-workbench__package-toggle"
                :class="{
                  active: Boolean(getPackageDraft(pkg.moduleId)[field.key]),
                }"
                @click="
                  setPackageDraftValue(
                    pkg.moduleId,
                    field.key,
                    !Boolean(getPackageDraft(pkg.moduleId)[field.key]),
                  )
                "
              >
                {{ getPackageDraft(pkg.moduleId)[field.key] ? "ON" : "OFF" }}
              </button>
              <select
                v-else-if="field.type === 'select'"
                class="ew-builder-workbench__select"
                :value="getPackageDraft(pkg.moduleId)[field.key]"
                @change="
                  setPackageDraftValue(
                    pkg.moduleId,
                    field.key,
                    ($event.target as HTMLSelectElement).value,
                  )
                "
              >
                <option
                  v-for="option in field.options ?? []"
                  :key="`${pkg.moduleId}-${field.key}-${option}`"
                  :value="option"
                >
                  {{ option }}
                </option>
              </select>
              <input
                v-else-if="field.type === 'number'"
                type="number"
                class="ew-builder-workbench__input"
                :value="getPackageDraft(pkg.moduleId)[field.key]"
                :min="field.min"
                :max="field.max"
                :step="field.step ?? 1"
                @change="
                  setPackageDraftValue(
                    pkg.moduleId,
                    field.key,
                    Number(($event.target as HTMLInputElement).value),
                  )
                "
              />
              <input
                v-else
                type="text"
                class="ew-builder-workbench__input"
                :value="getPackageDraft(pkg.moduleId)[field.key]"
                :placeholder="field.placeholder"
                @change="
                  setPackageDraftValue(
                    pkg.moduleId,
                    field.key,
                    ($event.target as HTMLInputElement).value,
                  )
                "
              />
              <span
                v-if="field.description"
                class="ew-builder-workbench__package-help"
              >
                {{ field.description }}
              </span>
            </label>
          </div>

          <div class="ew-builder-workbench__package-actions">
            <button
              class="ew-builder-workbench__template-action"
              @click="togglePackagePreview(pkg.moduleId)"
            >
              {{
                expandedPackageIds.has(pkg.moduleId)
                  ? "收起内部结构"
                  : "查看内部结构"
              }}
            </button>
            <button
              class="ew-builder-workbench__template-action"
              @click="insertPackage(pkg.moduleId)"
            >
              插入到当前图
            </button>
          </div>

          <div
            v-if="expandedPackageIds.has(pkg.moduleId)"
            class="ew-builder-workbench__package-preview"
          >
            <div class="ew-builder-workbench__summary-label">内部节点</div>
            <div class="ew-builder-workbench__template-tags">
              <span
                v-for="label in getCompositePreviewLabels(pkg.moduleId)"
                :key="`${pkg.moduleId}-${label}`"
                class="ew-builder-workbench__template-tag"
              >
                {{ label }}
              </span>
            </div>
            <template
              v-if="getCompositeEntryContractLabels(pkg.moduleId).length > 0"
            >
              <div class="ew-builder-workbench__summary-label">入口约定</div>
              <div class="ew-builder-workbench__template-tags">
                <span
                  v-for="label in getCompositeEntryContractLabels(pkg.moduleId)"
                  :key="`${pkg.moduleId}-entry-${label}`"
                  class="ew-builder-workbench__template-tag"
                >
                  {{ label }}
                </span>
              </div>
            </template>
            <template
              v-if="getCompositeExitContractLabels(pkg.moduleId).length > 0"
            >
              <div class="ew-builder-workbench__summary-label">出口约定</div>
              <div class="ew-builder-workbench__template-tags">
                <span
                  v-for="label in getCompositeExitContractLabels(pkg.moduleId)"
                  :key="`${pkg.moduleId}-exit-${label}`"
                  class="ew-builder-workbench__template-tag"
                >
                  {{ label }}
                </span>
              </div>
            </template>
            <template v-if="getCompositeRetryReasonLabel(pkg.moduleId)">
              <div class="ew-builder-workbench__summary-label">重试资格</div>
              <div class="ew-builder-workbench__template-tags">
                <span class="ew-builder-workbench__template-tag">
                  {{ getCompositeRetryReasonLabel(pkg.moduleId) }}
                </span>
                <span
                  v-for="label in getCompositeRetryBlockingLabels(pkg.moduleId)"
                  :key="`${pkg.moduleId}-retry-${label}`"
                  class="ew-builder-workbench__template-tag"
                >
                  {{ label }}
                </span>
              </div>
            </template>
            <p class="ew-builder-workbench__template-description">
              {{
                formatCompositeKind(pkg) === "片段"
                  ? "片段适合插到已有链路里做内联复用。插入后会直接展开为真实子图，你可以继续改内部节点与连线。"
                  : "插入后会直接展开为真实子图，你可以继续连线、改参数、删节点，而不是被锁在黑盒包里。"
              }}
            </p>
          </div>
        </article>
      </div>
    </section>

    <div class="ew-builder-workbench__body">
      <div class="ew-builder-workbench__editor">
        <EwGraphEditor
          :graph="activeGraph"
          :saved-slots="savedSlots"
          @save-slots="$emit('save-slots', $event)"
          @update:graph="onGraphUpdated"
          @select-node="selectedNodeId = $event"
        />
      </div>

      <aside
        v-if="showSidebar"
        class="ew-builder-workbench__sidebar"
      >
        <section class="ew-builder-workbench__section">
          <div class="ew-builder-workbench__section-header">
            <div>
              <div class="ew-builder-workbench__eyebrow">
                {{ currentBuilderMode === "advanced" ? "Advanced" : "Simple" }}
              </div>
              <h3 class="ew-builder-workbench__title">工作流设定</h3>
            </div>
          </div>
          <div class="ew-builder-workbench__summary-grid">
            <article class="ew-builder-workbench__summary-card">
              <span class="ew-builder-workbench__summary-label">名称</span>
              <strong>{{ activeGraph?.name || "未命名图" }}</strong>
            </article>
            <article class="ew-builder-workbench__summary-card">
              <span class="ew-builder-workbench__summary-label">状态</span>
              <strong>{{ activeGraph?.enabled ? "已启用" : "已禁用" }}</strong>
            </article>
            <article class="ew-builder-workbench__summary-card">
              <span class="ew-builder-workbench__summary-label">节点</span>
              <strong>{{ activeGraph?.nodes.length ?? 0 }}</strong>
            </article>
            <article class="ew-builder-workbench__summary-card">
              <span class="ew-builder-workbench__summary-label">连线</span>
              <strong>{{ activeGraph?.edges.length ?? 0 }}</strong>
            </article>
          </div>
          <div class="ew-builder-workbench__stack">
            <label class="ew-builder-workbench__field">
              <span class="ew-builder-workbench__field-label">生成定位</span>
              <select
                v-model="currentGenerationOwnership"
                class="ew-builder-workbench__select"
              >
                <option value="assistive">辅助工作流</option>
                <option value="optional_main_takeover">渐进主生成接管</option>
              </select>
            </label>
            <label class="ew-builder-workbench__field">
              <span class="ew-builder-workbench__field-label">触发时机</span>
              <select
                v-model="currentTiming"
                class="ew-builder-workbench__select"
              >
                <option value="default">默认</option>
                <option value="before_reply">回复前</option>
                <option value="after_reply">回复后</option>
              </select>
            </label>
            <div class="ew-builder-workbench__kv">
              <span>模板来源</span>
              <strong>{{ activeTemplateLabel }}</strong>
            </div>
            <div
              v-if="visibleDiagnosticsSummary?.bridgeIntentSummary"
              class="ew-builder-workbench__kv"
            >
              <span>Bridge 原因</span>
              <strong>
                {{ visibleDiagnosticsSummary.bridgeIntentSummary.reasonLabel }}
              </strong>
            </div>
            <div
              v-if="visibleDiagnosticsSummary?.bridgeIntentSummary"
              class="ew-builder-workbench__kv"
            >
              <span>Bridge 意图</span>
              <strong>
                {{ visibleDiagnosticsSummary.bridgeIntentSummary.graphIntentLabel }}
              </strong>
            </div>
            <div
              v-if="visibleDiagnosticsSummary?.bridgeIntentSummary?.requestedTimingFilter"
              class="ew-builder-workbench__kv"
            >
              <span>触发时机</span>
              <strong>
                {{
                  visibleDiagnosticsSummary.bridgeIntentSummary.requestedTimingLabel
                }}
              </strong>
            </div>
            <div
              v-if="visibleDiagnosticsSummary?.bridgeIntentSummary"
              class="ew-builder-workbench__kv"
            >
              <span>接管候选图</span>
              <strong>
                {{ visibleDiagnosticsSummary.bridgeIntentSummary.takeoverCandidateCount }}
              </strong>
            </div>
            <div
              v-if="
                (visibleDiagnosticsSummary?.bridgeIntentSummary
                  ?.timingFilteredOutGraphIds.length ?? 0) > 0
              "
              class="ew-builder-workbench__kv"
            >
              <span>时机过滤图</span>
              <strong>
                {{
                  visibleDiagnosticsSummary.bridgeIntentSummary
                    .timingFilteredOutGraphIds.length
                }}
              </strong>
            </div>
            <p
              v-if="activeTemplateSummary"
              class="ew-builder-workbench__text"
            >
              {{ activeTemplateSummary }}
            </p>
            <p
              v-if="activeTemplateDescription"
              class="ew-builder-workbench__text"
            >
              {{ activeTemplateDescription }}
            </p>
            <p class="ew-builder-workbench__text">
              {{ generationOwnershipHint }}
            </p>
            <p
              v-if="
                (visibleDiagnosticsSummary?.bridgeIntentSummary
                  ?.timingFilteredOutGraphLabels.length ?? 0) > 0
              "
              class="ew-builder-workbench__text"
            >
              当前触发时机为
              {{ visibleDiagnosticsSummary.bridgeIntentSummary.requestedTimingLabel }}，
              以下已启用图未命中本次执行：
              {{
                visibleDiagnosticsSummary.bridgeIntentSummary.timingFilteredOutGraphLabels.join(
                  "、",
                )
              }}。
            </p>
          </div>
        </section>

        <section
          v-if="showAdvancedDetails"
          class="ew-builder-workbench__section"
        >
          <div class="ew-builder-workbench__section-header">
            <div>
              <div class="ew-builder-workbench__eyebrow">高级诊断</div>
              <h3 class="ew-builder-workbench__title">运行摘要</h3>
            </div>
          </div>
          <div v-if="visibleActiveRunSummary" class="ew-builder-workbench__stack">
            <div class="ew-builder-workbench__chips">
              <span
                class="ew-builder-workbench__chip"
                :data-status="visibleActiveRunSummary.status"
              >
                {{ visibleActiveRunSummary.statusLabel }}
              </span>
              <span class="ew-builder-workbench__chip">
                {{ visibleActiveRunSummary.generationOwnershipLabel }}
              </span>
              <span
                v-if="visibleActiveRunSummary.bridgeIntentSummary"
                class="ew-builder-workbench__chip"
              >
                {{ visibleActiveRunSummary.bridgeIntentSummary.graphIntentLabel }}
              </span>
              <span class="ew-builder-workbench__chip">
                {{ visibleActiveRunSummary.phaseLabel }}
              </span>
              <span
                v-if="visibleActiveRunSummary.controlFlowSummary"
                class="ew-builder-workbench__chip"
              >
                控制流阻塞
                {{ visibleActiveRunSummary.controlFlowSummary.inactiveNodeCount }}
              </span>
              <span class="ew-builder-workbench__chip">
                {{ visibleActiveRunSummary.terminalOutcomeLabel }}
              </span>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>最近节点</span>
              <strong>{{ visibleActiveRunSummary.latestNodeLabel }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>节点状态</span>
              <strong>{{ visibleActiveRunSummary.latestNodeStatusLabel }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>图定位</span>
              <strong>{{ visibleActiveRunSummary.generationOwnershipLabel }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>阻塞契约</span>
              <strong>{{
                visibleActiveRunSummary.hasBlockingContract ? "存在" : "无"
              }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>恢复资格</span>
              <strong>{{ visibleActiveRunSummary.recoveryEligibilityLabel }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>waiting_user</span>
              <strong>{{ visibleActiveRunSummary.waitingUserLabel }}</strong>
            </div>
            <div
              v-if="visibleActiveRunSummary.controlFlowSummary"
              class="ew-builder-workbench__kv"
            >
              <span>控制流未激活</span>
              <strong>
                {{ visibleActiveRunSummary.controlFlowSummary.inactiveNodeIds.join("、") }}
              </strong>
            </div>
          </div>
          <div
            v-else-if="visibleDiagnosticsSummary"
            class="ew-builder-workbench__stack"
          >
            <div class="ew-builder-workbench__chips">
              <span
                class="ew-builder-workbench__chip"
                :data-status="visibleDiagnosticsSummary.runStatus"
              >
                {{ visibleDiagnosticsSummary.runStatusLabel }}
              </span>
              <span
                v-if="visibleDiagnosticsSummary.bridgeIntentSummary"
                class="ew-builder-workbench__chip"
              >
                {{ visibleDiagnosticsSummary.bridgeIntentSummary.reasonLabel }}
              </span>
              <span class="ew-builder-workbench__chip">
                指纹 {{ visibleDiagnosticsSummary.compileFingerprintShort }}
              </span>
              <span
                v-if="visibleDiagnosticsSummary.controlFlowSummary"
                class="ew-builder-workbench__chip"
              >
                控制流阻塞
                {{ visibleDiagnosticsSummary.controlFlowSummary.inactiveNodeCount }}
              </span>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>节点</span>
              <strong>{{ visibleDiagnosticsSummary.nodeCount }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>Dirty</span>
              <strong>{{ visibleDiagnosticsSummary.dirtyNodeCount }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>Reuse eligible</span>
              <strong>{{
                visibleDiagnosticsSummary.reuseEligibleNodeCount
              }}</strong>
            </div>
            <div
              v-if="visibleDiagnosticsSummary.bridgeIntentSummary"
              class="ew-builder-workbench__kv"
            >
              <span>Bridge 原因</span>
              <strong>
                {{ visibleDiagnosticsSummary.bridgeIntentSummary.reasonLabel }}
              </strong>
            </div>
            <div
              v-if="visibleDiagnosticsSummary.bridgeIntentSummary"
              class="ew-builder-workbench__kv"
            >
              <span>接管候选图</span>
              <strong>
                {{ visibleDiagnosticsSummary.bridgeIntentSummary.takeoverCandidateCount }}
              </strong>
            </div>
            <div
              v-if="
                visibleDiagnosticsSummary.bridgeIntentSummary
                  .requestedTimingFilter
              "
              class="ew-builder-workbench__kv"
            >
              <span>触发时机</span>
              <strong>
                {{
                  visibleDiagnosticsSummary.bridgeIntentSummary
                    .requestedTimingLabel
                }}
              </strong>
            </div>
            <div
              v-if="visibleDiagnosticsSummary.controlFlowSummary"
              class="ew-builder-workbench__kv"
            >
              <span>控制流未激活</span>
              <strong>
                {{
                  visibleDiagnosticsSummary.controlFlowSummary.inactiveNodeIds.join(
                    "、",
                  )
                }}
              </strong>
            </div>
          </div>
          <div v-else class="ew-builder-workbench__empty">
            当前图暂无可展示的运行摘要。
          </div>
        </section>

        <section
          v-if="showAdvancedDetails"
          class="ew-builder-workbench__section"
        >
          <div class="ew-builder-workbench__section-header">
            <div>
              <div class="ew-builder-workbench__eyebrow">模块说明</div>
              <h3 class="ew-builder-workbench__title">当前选中节点</h3>
            </div>
          </div>
          <template v-if="selectedModuleExplain && selectedNode">
            <div class="ew-builder-workbench__stack">
              <div class="ew-builder-workbench__chips">
                <span class="ew-builder-workbench__chip">
                  {{ selectedNode.moduleId }}
                </span>
                <span class="ew-builder-workbench__chip">
                  {{ selectedModuleExplain.diagnostics.capability }}
                </span>
                <span class="ew-builder-workbench__chip">
                  {{ selectedModuleExplain.diagnostics.sideEffect }}
                </span>
              </div>
              <div class="ew-builder-workbench__kv">
                <span>标题</span>
                <strong>{{ selectedModuleLabel }}</strong>
              </div>
              <p
                v-if="selectedModuleExplain.help?.summary"
                class="ew-builder-workbench__text"
              >
                {{ selectedModuleExplain.help.summary }}
              </p>
              <div class="ew-builder-workbench__kv">
                <span>必填配置</span>
                <strong>{{
                  selectedModuleExplain.config.requiredConfigKeys.join("、") ||
                  "无"
                }}</strong>
              </div>
              <div class="ew-builder-workbench__kv">
                <span>Schema 字段</span>
                <strong>{{
                  selectedModuleExplain.config.schemaFields
                    .map((field) => field.key)
                    .join("、") || "无"
                }}</strong>
              </div>
            </div>
          </template>
          <div v-else class="ew-builder-workbench__empty">
            选中一个节点后，这里会显示模块说明与配置约束。
          </div>
        </section>

        <section
          v-if="showAdvancedDetails && selectedNodeDiagnostics"
          class="ew-builder-workbench__section"
        >
          <div class="ew-builder-workbench__section-header">
            <div>
              <div class="ew-builder-workbench__eyebrow">节点诊断</div>
              <h3 class="ew-builder-workbench__title">
                {{ selectedNodeDiagnostics.title }}
              </h3>
            </div>
          </div>
          <div class="ew-builder-workbench__stack">
            <div class="ew-builder-workbench__chips">
              <span class="ew-builder-workbench__chip">
                dirty {{ selectedNodeDiagnostics.dirtyReasonLabel }}
              </span>
              <span class="ew-builder-workbench__chip">
                reuse {{ selectedNodeDiagnostics.reuseVerdictLabel }}
              </span>
              <span class="ew-builder-workbench__chip">
                decision {{ selectedNodeDiagnostics.executionDecisionLabel }}
              </span>
            </div>
            <p class="ew-builder-workbench__text">
              {{ selectedNodeDiagnostics.disclaimer }}
            </p>
            <div class="ew-builder-workbench__kv">
              <span>输入源概要</span>
              <strong>{{ selectedNodeDiagnostics.inputSourcesSummary }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>Cache Key Facts</span>
              <strong>{{
                selectedNodeDiagnostics.cacheKeyFactsSummary
              }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>只读命中事实</span>
              <strong>{{
                selectedNodeDiagnostics.reusableOutputsFactLabel
              }}</strong>
            </div>
            <div class="ew-builder-workbench__kv">
              <span>skip_reuse_outputs</span>
              <strong>{{
                selectedNodeDiagnostics.skipReuseOutputsFactLabel
              }}</strong>
            </div>
            <div
              v-if="selectedNodeDiagnostics.hasControlFlowExplain"
              class="ew-builder-workbench__kv"
            >
              <span>控制流执行位形</span>
              <strong>{{
                selectedNodeDiagnostics.controlFlowDispositionLabel
              }}</strong>
            </div>
            <div
              v-if="selectedNodeDiagnostics.hasControlFlowExplain"
              class="ew-builder-workbench__kv"
            >
              <span>控制流就绪解释</span>
              <strong>{{
                selectedNodeDiagnostics.controlFlowReadinessLabel
              }}</strong>
            </div>
            <div
              v-if="selectedNodeDiagnostics.hasControlFlowExplain"
              class="ew-builder-workbench__kv"
            >
              <span>控制流执行前沿</span>
              <strong>{{
                selectedNodeDiagnostics.controlFlowFrontierLabel
              }}</strong>
            </div>
          </div>
        </section>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { klona } from "klona/full";
import {
  BUILDER_WORKFLOW_TEMPLATES,
  createBlankBuilderGraph,
  findBuilderWorkflowTemplate,
} from "./builder-templates";
import EwGraphEditor from "./EwGraphEditor.vue";
import {
  getCompositeModuleKind,
  getCompositeModules,
  getCompositeRetrySafety,
  getCompositeTemplateContract,
  getModuleBlueprint,
  getModuleExplainContract,
  instantiateCompositeTemplate,
} from "./module-registry";
import type {
  ModuleBlueprint,
  GraphActiveRunSummaryViewModel,
  GraphNodeDiagnosticsViewModel,
  GraphRunDiagnosticsSummaryViewModel,
  ModuleExplainContract,
  WorkbenchBuilderMode,
  WorkbenchGenerationOwnership,
  WorkbenchGraph,
} from "./module-types";

const props = defineProps<{
  graphs: WorkbenchGraph[];
  savedSlots?: Array<any>;
  diagnosticsSummary: GraphRunDiagnosticsSummaryViewModel | null;
  activeRunSummary: GraphActiveRunSummaryViewModel | null;
}>();

const emit = defineEmits<{
  (e: "update:graphs", graphs: WorkbenchGraph[]): void;
  (e: "save-slots", slots: any[]): void;
}>();

const localGraphs = ref<WorkbenchGraph[]>(klona(props.graphs));
const activeGraphId = ref(localGraphs.value[0]?.id ?? "");
const advancedSidebarOpen = ref(true);
const templateLibraryOpen = ref(true);
const selectedNodeId = ref<string | null>(null);
const builderTemplates = BUILDER_WORKFLOW_TEMPLATES;
const expandedPackageIds = reactive(new Set<string>());
const packageDrafts = reactive<Record<string, Record<string, any>>>({});

const BUILDER_MODE_LABELS: Record<WorkbenchBuilderMode, string> = {
  simple: "Simple",
  advanced: "Advanced",
};

const OWNERSHIP_LABELS: Record<WorkbenchGenerationOwnership, string> = {
  assistive: "辅助工作流",
  optional_main_takeover: "渐进主生成接管",
};

const TIMING_LABELS: Record<WorkbenchGraph["timing"], string> = {
  default: "默认",
  before_reply: "回复前",
  after_reply: "回复后",
};

const activeGraph = computed(() =>
  localGraphs.value.find((graph) => graph.id === activeGraphId.value) ?? null,
);

const compositePackages = computed<ModuleBlueprint[]>(() =>
  getCompositeModules().filter(
    (module) => (module.compositeTemplate?.nodes.length ?? 0) > 0,
  ),
);

const activeTemplate = computed(() =>
  findBuilderWorkflowTemplate(activeGraph.value?.runtimeMeta?.templateId),
);

const activeTemplateLabel = computed(() => {
  return (
    activeGraph.value?.runtimeMeta?.templateLabel ??
    activeTemplate.value?.label ??
    "自定义图"
  );
});

const activeTemplateSummary = computed(() => {
  return activeTemplate.value?.summary ?? null;
});

const activeTemplateDescription = computed(() => {
  return activeTemplate.value?.description ?? null;
});

const isActiveGraphEffectivelyEmpty = computed(() => {
  return Boolean(
    activeGraph.value &&
      activeGraph.value.nodes.length === 0 &&
      activeGraph.value.edges.length === 0,
  );
});

const replaceEmptyGraph = computed(() => isActiveGraphEffectivelyEmpty.value);

const showTemplateLibrary = computed(() => {
  return (
    templateLibraryOpen.value ||
    isActiveGraphEffectivelyEmpty.value ||
    localGraphs.value.length === 0
  );
});

const currentBuilderMode = computed<WorkbenchBuilderMode>({
  get() {
    return activeGraph.value?.runtimeMeta?.builderMode === "advanced"
      ? "advanced"
      : "simple";
  },
  set(mode) {
    updateActiveGraphRuntimeMeta({ builderMode: mode });
    advancedSidebarOpen.value = mode === "advanced";
  },
});

const currentGenerationOwnership = computed<WorkbenchGenerationOwnership>({
  get() {
    return activeGraph.value?.runtimeMeta?.generationOwnership ===
      "optional_main_takeover"
      ? "optional_main_takeover"
      : "assistive";
  },
  set(value) {
    updateActiveGraphRuntimeMeta({ generationOwnership: value });
  },
});

const currentTiming = computed<WorkbenchGraph["timing"]>({
  get() {
    return activeGraph.value?.timing ?? "default";
  },
  set(value) {
    if (!activeGraph.value) {
      return;
    }
    activeGraph.value.timing = value;
    emitGraphs();
  },
});

const generationOwnershipHint = computed(() => {
  if (currentGenerationOwnership.value === "optional_main_takeover") {
    return "这张图会被标记为“渐进主生成接管”预备工作流。当前只是 ownership / takeover 占位，不会切掉 legacy fallback。";
  }
  return "这张图会继续作为辅助工作流存在，适合做回复注入、后处理、结果绑定等次级链路。";
});

const showAdvancedDetails = computed(
  () => currentBuilderMode.value === "advanced",
);

const showSidebar = computed(() => {
  if (!activeGraph.value) {
    return false;
  }
  return currentBuilderMode.value === "simple" || advancedSidebarOpen.value;
});

const visibleActiveRunSummary = computed(() => {
  const summary = props.activeRunSummary;
  if (!summary || !activeGraph.value) {
    return null;
  }
  return summary.graphId === activeGraph.value.id ? summary : null;
});

const visibleDiagnosticsSummary = computed(() => {
  return (
    visibleActiveRunSummary.value?.diagnosticsSummary ??
    (localGraphs.value.length <= 1 ? props.diagnosticsSummary : null) ??
    null
  );
});

const selectedNode = computed(() => {
  if (!selectedNodeId.value || !activeGraph.value) {
    return null;
  }
  return (
    activeGraph.value.nodes.find((node) => node.id === selectedNodeId.value) ??
    null
  );
});

const selectedModuleExplain = computed<ModuleExplainContract | null>(() => {
  return selectedNode.value
    ? getModuleExplainContract(selectedNode.value.moduleId)
    : null;
});

const selectedModuleLabel = computed(() => {
  if (!selectedNode.value) {
    return "";
  }
  try {
    return getModuleBlueprint(selectedNode.value.moduleId).label;
  } catch {
    return selectedNode.value.moduleId;
  }
});

const selectedNodeDiagnostics = computed<GraphNodeDiagnosticsViewModel | null>(
  () => {
    const diagnostics = visibleActiveRunSummary.value?.nodeDiagnostics;
    if (!diagnostics || !selectedNodeId.value) {
      return null;
    }
    return diagnostics.nodeId === selectedNodeId.value ? diagnostics : null;
  },
);

function formatBuilderMode(mode: WorkbenchBuilderMode): string {
  return BUILDER_MODE_LABELS[mode];
}

function formatOwnership(ownership: WorkbenchGenerationOwnership): string {
  return OWNERSHIP_LABELS[ownership];
}

function formatTiming(timing: WorkbenchGraph["timing"]): string {
  return TIMING_LABELS[timing];
}

function formatCompositeKind(module: ModuleBlueprint): string {
  return getCompositeModuleKind(module) === "fragment" ? "片段" : "包";
}

function updateActiveGraphRuntimeMeta(
  patch: Partial<NonNullable<WorkbenchGraph["runtimeMeta"]>>,
) {
  if (!activeGraph.value) {
    return;
  }
  activeGraph.value.runtimeMeta = {
    schemaVersion: activeGraph.value.runtimeMeta?.schemaVersion ?? 1,
    runtimeKind: activeGraph.value.runtimeMeta?.runtimeKind ?? "dataflow",
    ...(activeGraph.value.runtimeMeta ?? {}),
    ...patch,
  };
  emitGraphs();
}

watch(
  () => props.graphs,
  (graphs) => {
    localGraphs.value = klona(graphs);
    if (localGraphs.value.length === 0) {
      activeGraphId.value = "";
      selectedNodeId.value = null;
      return;
    }
    if (!localGraphs.value.some((graph) => graph.id === activeGraphId.value)) {
      activeGraphId.value = localGraphs.value[0].id;
      selectedNodeId.value = null;
    }
  },
  { deep: true, immediate: true },
);

watch(activeGraphId, () => {
  selectedNodeId.value = null;
  if (currentBuilderMode.value === "simple") {
    advancedSidebarOpen.value = false;
  }
});

function emitGraphs() {
  emit("update:graphs", klona(localGraphs.value));
}

function setBuilderMode(mode: WorkbenchBuilderMode) {
  currentBuilderMode.value = mode;
}

function getPackageDraft(moduleId: string): Record<string, any> {
  if (!packageDrafts[moduleId]) {
    const blueprint = getModuleBlueprint(moduleId);
    packageDrafts[moduleId] = klona(blueprint.defaultConfig ?? {});
  }
  return packageDrafts[moduleId];
}

function setPackageDraftValue(moduleId: string, key: string, value: any) {
  const draft = getPackageDraft(moduleId);
  draft[key] = value;
}

function togglePackagePreview(moduleId: string) {
  if (expandedPackageIds.has(moduleId)) {
    expandedPackageIds.delete(moduleId);
  } else {
    expandedPackageIds.add(moduleId);
  }
}

function getCompositePreviewLabels(moduleId: string): string[] {
  const blueprint = getModuleBlueprint(moduleId);
  const nodes = blueprint.compositeTemplate?.nodes ?? [];
  return nodes.map((node) => {
    if (typeof node.config?._label === "string" && node.config._label.trim()) {
      return node.config._label;
    }
    try {
      return getModuleBlueprint(node.moduleId).label;
    } catch {
      return node.moduleId;
    }
  });
}

function formatCompositeContractTarget(target: {
  nodeLabel: string;
  portLabel: string;
  kind: "data" | "activation";
}): string {
  return `${target.nodeLabel}.${target.portLabel}${target.kind === "activation" ? " (activation)" : ""}`;
}

function getCompositeEntryContractLabels(moduleId: string): string[] {
  const contract = getCompositeTemplateContract(moduleId);
  if (!contract || contract.entries.length === 0) {
    return [];
  }
  return contract.entries.map((entry) => {
    const targets = entry.targets.map(formatCompositeContractTarget).join("、");
    return `${entry.label} · ${targets}`;
  });
}

function getCompositeExitContractLabels(moduleId: string): string[] {
  const contract = getCompositeTemplateContract(moduleId);
  if (!contract || contract.exits.length === 0) {
    return [];
  }
  return contract.exits.map((entry) => {
    return `${entry.label} · ${formatCompositeContractTarget(entry.source)}`;
  });
}

function getCompositeRetryReasonLabel(moduleId: string): string | null {
  const retrySafety = getCompositeRetrySafety(moduleId);
  return retrySafety?.reasonLabel ?? null;
}

function getCompositeRetryBlockingLabels(moduleId: string): string[] {
  const retrySafety = getCompositeRetrySafety(moduleId);
  if (!retrySafety || retrySafety.blockingNodeLabels.length === 0) {
    return [];
  }
  return retrySafety.blockingNodeLabels.map((label) => `阻塞节点 · ${label}`);
}

function getNextPackageOrigin(): { x: number; y: number } {
  const nodes = activeGraph.value?.nodes ?? [];
  if (nodes.length === 0) {
    return { x: 80, y: 100 };
  }
  const maxX = Math.max(...nodes.map((node) => node.position.x));
  const minY = Math.min(...nodes.map((node) => node.position.y));
  return {
    x: maxX + 280,
    y: Math.max(60, minY),
  };
}

function insertPackage(moduleId: string) {
  if (!activeGraph.value) {
    return;
  }
  const fragment = instantiateCompositeTemplate({
    moduleId,
    origin: getNextPackageOrigin(),
    exposedConfig: getPackageDraft(moduleId),
  });
  if (!fragment) {
    return;
  }
  activeGraph.value.nodes.push(...fragment.nodes);
  activeGraph.value.edges.push(...fragment.edges);
  selectedNodeId.value = null;
  emitGraphs();
}

function createGraphFromTemplate(templateId: string) {
  const template = findBuilderWorkflowTemplate(templateId);
  if (!template) {
    return;
  }

  const nextGraph = template.createGraph();
  if (replaceEmptyGraph.value && activeGraph.value) {
    const index = localGraphs.value.findIndex(
      (graph) => graph.id === activeGraph.value?.id,
    );
    if (index >= 0) {
      localGraphs.value.splice(index, 1, nextGraph);
    } else {
      localGraphs.value.push(nextGraph);
    }
  } else {
    localGraphs.value.push(nextGraph);
  }

  activeGraphId.value = nextGraph.id;
  selectedNodeId.value = null;
  advancedSidebarOpen.value = nextGraph.runtimeMeta?.builderMode === "advanced";
  templateLibraryOpen.value = false;
  emitGraphs();
}

function addGraph() {
  const nextGraph = createBlankBuilderGraph({
    name: `工作流 ${localGraphs.value.length + 1}`,
    builderMode: currentBuilderMode.value,
    generationOwnership: currentGenerationOwnership.value,
    timing: currentTiming.value,
  });
  localGraphs.value.push(nextGraph);
  activeGraphId.value = nextGraph.id;
  advancedSidebarOpen.value = nextGraph.runtimeMeta?.builderMode === "advanced";
  emitGraphs();
}

function renameGraph() {
  if (!activeGraph.value) {
    return;
  }
  const nextName = prompt("图名称:", activeGraph.value.name);
  if (nextName === null) {
    return;
  }
  activeGraph.value.name = nextName;
  emitGraphs();
}

function toggleEnabled() {
  if (!activeGraph.value) {
    return;
  }
  activeGraph.value.enabled = !activeGraph.value.enabled;
  emitGraphs();
}

function onGraphUpdated(graph: WorkbenchGraph) {
  const index = localGraphs.value.findIndex(
    (item) => item.id === activeGraphId.value,
  );
  if (index >= 0) {
    localGraphs.value.splice(index, 1, klona(graph));
  } else {
    localGraphs.value = [klona(graph)];
    activeGraphId.value = graph.id;
  }
  emitGraphs();
}
</script>

<style scoped>
.ew-builder-workbench {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 12px;
}

.ew-builder-workbench__topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 42px;
  padding: 0 4px;
}

.ew-builder-workbench__tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
}

.ew-builder-workbench__tab {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.62);
  border-radius: 999px;
  padding: 7px 12px;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;
}

.ew-builder-workbench__tab.active {
  background: rgba(99, 102, 241, 0.18);
  border-color: rgba(99, 102, 241, 0.4);
  color: rgba(255, 255, 255, 0.92);
}

.ew-builder-workbench__tab--add {
  font-weight: 700;
  min-width: 34px;
}

.ew-builder-workbench__controls {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ew-builder-workbench__mode-switch {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.ew-builder-workbench__mode-btn {
  border: 0;
  background: transparent;
  color: rgba(255, 255, 255, 0.62);
  border-radius: 999px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 12px;
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.ew-builder-workbench__mode-btn.active {
  background: rgba(99, 102, 241, 0.18);
  color: rgba(255, 255, 255, 0.92);
}

.ew-builder-workbench__ctrl-btn {
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.68);
  cursor: pointer;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    color 0.16s ease;
}

.ew-builder-workbench__ctrl-btn:hover:not(:disabled),
.ew-builder-workbench__ctrl-btn.active {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.16);
  color: rgba(255, 255, 255, 0.92);
}

.ew-builder-workbench__ctrl-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.ew-builder-workbench__starter {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background:
    linear-gradient(135deg, rgba(36, 56, 112, 0.3), rgba(11, 15, 26, 0.84)),
    rgba(8, 12, 24, 0.78);
  border-radius: 20px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ew-builder-workbench__packages {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(8, 12, 24, 0.72);
  border-radius: 20px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ew-builder-workbench__starter-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.ew-builder-workbench__starter-copy {
  margin: 0;
  max-width: 420px;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.74);
}

.ew-builder-workbench__template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.ew-builder-workbench__package-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}

.ew-builder-workbench__template-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.04);
}

.ew-builder-workbench__package-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}

.ew-builder-workbench__template-card[data-ownership="optional_main_takeover"] {
  border-color: rgba(251, 191, 36, 0.26);
  background: rgba(251, 191, 36, 0.08);
}

.ew-builder-workbench__template-title {
  margin: 0;
  font-size: 15px;
  line-height: 1.3;
  color: rgba(255, 255, 255, 0.94);
}

.ew-builder-workbench__template-summary {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.84);
}

.ew-builder-workbench__template-description {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.64);
}

.ew-builder-workbench__template-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ew-builder-workbench__template-tag {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.76);
}

.ew-builder-workbench__template-action {
  margin-top: auto;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(255, 255, 255, 0.92);
  padding: 10px 12px;
  cursor: pointer;
  transition:
    background 0.16s ease,
    border-color 0.16s ease,
    transform 0.16s ease;
}

.ew-builder-workbench__template-action:hover {
  background: rgba(99, 102, 241, 0.18);
  border-color: rgba(99, 102, 241, 0.36);
  transform: translateY(-1px);
}

.ew-builder-workbench__package-fields {
  display: grid;
  gap: 8px;
}

.ew-builder-workbench__package-help {
  font-size: 11px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.52);
}

.ew-builder-workbench__package-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.ew-builder-workbench__package-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.ew-builder-workbench__body {
  display: flex;
  gap: 12px;
  min-height: 0;
  flex: 1;
}

.ew-builder-workbench__editor {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.ew-builder-workbench__editor :deep(.ew-graph-root) {
  height: min(72vh, 780px);
}

.ew-builder-workbench__sidebar {
  width: 340px;
  max-width: 36vw;
  min-width: 300px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ew-builder-workbench__section {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(8, 12, 24, 0.68);
  border-radius: 16px;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.ew-builder-workbench__section-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.ew-builder-workbench__eyebrow {
  font-size: 11px;
  line-height: 1.2;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.42);
}

.ew-builder-workbench__title {
  margin: 2px 0 0;
  font-size: 15px;
  line-height: 1.2;
  color: rgba(255, 255, 255, 0.92);
}

.ew-builder-workbench__summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.ew-builder-workbench__summary-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
}

.ew-builder-workbench__summary-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.44);
}

.ew-builder-workbench__summary-card strong {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
}

.ew-builder-workbench__stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.ew-builder-workbench__field {
  display: grid;
  gap: 6px;
}

.ew-builder-workbench__field-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.46);
}

.ew-builder-workbench__select {
  width: 100%;
  min-height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.92);
  padding: 0 12px;
}

.ew-builder-workbench__input {
  width: 100%;
  min-height: 36px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.92);
  padding: 0 12px;
}

.ew-builder-workbench__package-toggle {
  min-height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  color: rgba(255, 255, 255, 0.72);
  cursor: pointer;
}

.ew-builder-workbench__package-toggle.active {
  background: rgba(16, 185, 129, 0.18);
  border-color: rgba(16, 185, 129, 0.34);
  color: rgba(209, 250, 229, 0.96);
}

.ew-builder-workbench__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ew-builder-workbench__chip {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  font-size: 11px;
  color: rgba(255, 255, 255, 0.84);
}

.ew-builder-workbench__chip[data-status="completed"] {
  background: rgba(16, 185, 129, 0.2);
  color: #bbf7d0;
}

.ew-builder-workbench__chip[data-status="failed"] {
  background: rgba(239, 68, 68, 0.2);
  color: #fecaca;
}

.ew-builder-workbench__chip[data-status="running"],
.ew-builder-workbench__chip[data-status="streaming"],
.ew-builder-workbench__chip[data-status="queued"],
.ew-builder-workbench__chip[data-status="waiting_user"],
.ew-builder-workbench__chip[data-status="cancelling"] {
  background: rgba(59, 130, 246, 0.18);
  color: #bfdbfe;
}

.ew-builder-workbench__chip[data-status="cancelled"] {
  background: rgba(148, 163, 184, 0.18);
  color: #e2e8f0;
}

.ew-builder-workbench__kv {
  display: grid;
  gap: 4px;
}

.ew-builder-workbench__kv span {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.46);
}

.ew-builder-workbench__kv strong {
  font-size: 12px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.9);
}

.ew-builder-workbench__text {
  margin: 0;
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.76);
}

.ew-builder-workbench__empty {
  font-size: 12px;
  line-height: 1.6;
  color: rgba(255, 255, 255, 0.52);
}

@media (max-width: 1180px) {
  .ew-builder-workbench__topbar,
  .ew-builder-workbench__starter-header {
    flex-direction: column;
    align-items: stretch;
  }

  .ew-builder-workbench__body {
    flex-direction: column;
  }

  .ew-builder-workbench__sidebar {
    width: 100%;
    max-width: none;
    min-width: 0;
  }

  .ew-builder-workbench__editor :deep(.ew-graph-root) {
    height: min(68vh, 700px);
  }
}
</style>
