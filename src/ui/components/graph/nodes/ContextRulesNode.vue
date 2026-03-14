<template>
  <div class="node-fields">
    <div class="node-field__list-header">
      <span>提取规则 ({{ (data.extract_rules || []).length }})</span>
    </div>
    <div v-for="(rule, i) in (data.extract_rules || [])" :key="'e' + i" class="node-field__list-item">
      <span class="node-field__list-text">{{ rule.pattern || `规则 #${i + 1}` }}</span>
    </div>

    <div class="node-field__list-header" style="margin-top: 6px;">
      <span>排除规则 ({{ (data.exclude_rules || []).length }})</span>
    </div>
    <div v-for="(rule, i) in (data.exclude_rules || [])" :key="'x' + i" class="node-field__list-item">
      <span class="node-field__list-text">{{ rule.pattern || `规则 #${i + 1}` }}</span>
    </div>

    <div class="node-field__list-header" style="margin-top: 6px;">
      <span>自定义正则 ({{ (data.custom_regex_rules || []).length }})</span>
    </div>
    <div v-for="(rule, i) in (data.custom_regex_rules || [])" :key="'r' + i" class="node-field__list-item">
      <span class="node-field__list-dot" :style="{ opacity: rule.enabled ? 1 : 0.3 }" />
      <span class="node-field__list-text">{{ rule.name || `正则 #${i + 1}` }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ data: Record<string, any> }>();
</script>
