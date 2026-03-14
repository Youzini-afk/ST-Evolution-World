<template>
  <div class="node-fields">
    <div class="node-field">
      <label>目标世界书</label>
      <input v-model="data.target_worldbook" placeholder="世界书名称" />
    </div>
    <div class="node-field">
      <label>条目名前缀</label>
      <input v-model="data.entry_prefix" placeholder="EW/" />
    </div>
    <div class="node-field node-field--row">
      <label>自动清理</label>
      <input type="checkbox" v-model="data.auto_cleanup" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ data: Record<string, any> }>();
</script>
