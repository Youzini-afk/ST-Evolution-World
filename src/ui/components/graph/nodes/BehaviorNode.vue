<template>
  <div class="node-fields">
    <div class="node-field">
      <label>名称行为</label>
      <select v-model="data.name_behavior">
        <option value="none">无</option>
        <option value="default">默认</option>
        <option value="complete_target">补全目标</option>
        <option value="message_content">消息内容</option>
      </select>
    </div>
    <div class="node-field">
      <label>推理强度</label>
      <select v-model="data.reasoning_effort">
        <option value="auto">自动</option>
        <option value="low">低</option>
        <option value="medium">中</option>
        <option value="high">高</option>
      </select>
    </div>
    <div class="node-field">
      <label>详细度</label>
      <select v-model="data.verbosity">
        <option value="auto">自动</option>
        <option value="low">低</option>
        <option value="medium">中</option>
        <option value="high">高</option>
      </select>
    </div>
    <div class="node-field node-field--row">
      <label>请求思考</label>
      <input type="checkbox" v-model="data.request_thinking" />
    </div>
    <div class="node-field node-field--row">
      <label>续写预填</label>
      <input type="checkbox" v-model="data.continue_prefill" />
    </div>
    <div class="node-field node-field--row">
      <label>合并系统消息</label>
      <input type="checkbox" v-model="data.squash_system_messages" />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{ data: Record<string, any> }>();
</script>
