<script setup>
defineProps({
  title: String,
  subtitle: String
})
</script>

<template>
  <div class="px-4 pt-4 pb-2">
    <h1 class="text-xl font-bold text-rose-900">{{ title }}</h1>
    <p v-if="subtitle" class="text-sm text-pink-400/70 mt-1">{{ subtitle }}</p>
  </div>
</template>
