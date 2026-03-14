<template>
  <div class="node-fields">
    <div class="node-field">
      <label>名称</label>
      <input v-model="data.name" placeholder="工作流名称" />
    </div>
    <div class="node-field node-field--row">
      <label>启用</label>
      <input type="checkbox" v-model="data.enabled" />
    </div>
    <div class="node-field">
      <label>时机</label>
      <select v-model="data.timing">
        <option value="default">默认</option>
        <option value="after_reply">回复后</option>
        <option value="before_reply">回复前</option>
      </select>
    </div>
    <div class="node-field">
      <label>优先级</label>
      <input type="number" v-model.number="data.priority" min="0" step="10" />
    </div>
    <div class="node-field">
      <label>API预设</label>
      <select v-model="data.api_preset_id">
        <option value="">无</option>
        <option v-for="p in (data._apiPresets || [])" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </div>
    <div class="node-field">
      <label>超时(ms)</label>
      <input type="number" v-model.number="data.timeout_ms" min="1000" step="1000" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ data: Record<string, any> }>();
</script>
