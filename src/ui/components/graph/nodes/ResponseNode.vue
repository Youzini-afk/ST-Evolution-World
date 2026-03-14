<template>
  <div class="node-fields">
    <div class="node-field">
      <label>提取正则</label>
      <input v-model="data.response_extract_regex" placeholder="提取正则" spellcheck="false" />
    </div>
    <div class="node-field">
      <label>移除正则</label>
      <input v-model="data.response_remove_regex" placeholder="移除正则" spellcheck="false" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ data: Record<string, any> }>();
</script>
