<template>
  <div class="node-fields">
    <div class="node-field">
      <label>请求模板</label>
      <textarea v-model="data.request_template" rows="3" placeholder="请求模板" spellcheck="false" />
    </div>
    <div class="node-field">
      <label>系统提示</label>
      <textarea v-model="data.system_prompt" rows="3" placeholder="系统提示词" spellcheck="false" />
    </div>
    <div class="node-field">
      <label>Headers JSON</label>
      <input v-model="data.headers_json" placeholder="{}" spellcheck="false" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ data: Record<string, any> }>();
</script>
