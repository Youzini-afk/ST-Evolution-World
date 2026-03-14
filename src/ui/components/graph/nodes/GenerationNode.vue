<template>
  <div class="node-fields">
    <div class="node-field node-field--slider">
      <label>温度 <span class="node-field__val">{{ data.temperature ?? 1.2 }}</span></label>
      <input type="range" v-model.number="data.temperature" min="0" max="2" step="0.05" />
    </div>
    <div class="node-field node-field--slider">
      <label>Top P <span class="node-field__val">{{ data.top_p ?? 0.92 }}</span></label>
      <input type="range" v-model.number="data.top_p" min="0" max="1" step="0.01" />
    </div>
    <div class="node-field node-field--slider">
      <label>频率惩罚 <span class="node-field__val">{{ data.frequency_penalty ?? 0.85 }}</span></label>
      <input type="range" v-model.number="data.frequency_penalty" min="0" max="2" step="0.05" />
    </div>
    <div class="node-field node-field--slider">
      <label>存在惩罚 <span class="node-field__val">{{ data.presence_penalty ?? 0.5 }}</span></label>
      <input type="range" v-model.number="data.presence_penalty" min="0" max="2" step="0.05" />
    </div>
    <div class="node-field">
      <label>最大回复长度</label>
      <input type="number" v-model.number="data.max_reply_tokens" min="1" />
    </div>
    <div class="node-field node-field--row">
      <label>流式传输</label>
      <input type="checkbox" v-model="data.stream" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ data: Record<string, any> }>();
</script>
