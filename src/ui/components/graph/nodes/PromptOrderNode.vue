<template>
  <div class="node-fields">
    <div class="node-field__list-header">
      <span>提示词条目 ({{ items.length }})</span>
    </div>
    <div v-if="items.length === 0" class="node-field__empty">暂无条目</div>
    <div v-for="(item, i) in items" :key="i" class="node-field__list-item">
      <span class="node-field__list-dot" :style="{ opacity: item.enabled ? 1 : 0.3 }" />
      <span class="node-field__list-text">{{ item.name || item.identifier || `#${i + 1}` }}</span>
      <span class="node-field__list-role">{{ item.role }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ data: Record<string, any> }>();

const items = computed(() => {
  return (props.data.prompt_order || []) as Array<{
    identifier: string; name: string; enabled: boolean;
    role: string; type: string;
  }>;
});
</script>
