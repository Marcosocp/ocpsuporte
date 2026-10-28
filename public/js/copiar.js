// Botões data-copiar="#seletor": copiam o valor do campo indicado.
document.querySelectorAll("[data-copiar]").forEach((botao) => {
  botao.addEventListener("click", async () => {
    const campo = document.querySelector(botao.dataset.copiar);
    try {
      await navigator.clipboard.writeText(campo.value);
    } catch {
      campo.select(); // sem permissão de área de transferência (http): deixa selecionado para Ctrl+C
      return;
    }
    const original = botao.textContent;
    botao.textContent = "Copiado";
    setTimeout(() => { botao.textContent = original; }, 1500);
  });
});
