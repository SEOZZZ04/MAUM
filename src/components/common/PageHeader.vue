<script setup>
defineProps({
  title: String,
  subtitle: String
})
</script>

<template>
  <div class="px-4 pt-4 pb-2">
    <h1 class="text-xl font-bold font-display text-[#5d4e37]">{{ title }}</h1>
    <p v-if="subtitle" class="text-sm text-[#b5a48e] mt-1">{{ subtitle }}</p>
  </div>
</template>
