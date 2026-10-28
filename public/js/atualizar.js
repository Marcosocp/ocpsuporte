// Recarrega a página enquanto o assistente analisa o chamado (elemento com data-atualizar="segundos").
const el = document.querySelector("[data-atualizar]");
if (el) setTimeout(() => window.location.reload(), Number(el.dataset.atualizar) * 1000);
