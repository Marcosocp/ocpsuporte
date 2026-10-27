// Pede confirmação antes de enviar formulários marcados com data-confirmar.
document.querySelectorAll("form[data-confirmar]").forEach((form) => {
  form.addEventListener("submit", (e) => {
    if (!confirm(form.dataset.confirmar)) e.preventDefault();
  });
});
