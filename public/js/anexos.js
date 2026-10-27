// Anexos: lista os arquivos escolhidos e permite colar prints (Ctrl+V) direto na caixa de texto.
for (const entrada of document.querySelectorAll("input[data-anexos]")) {
  const form = entrada.form;
  const lista = form.querySelector("[data-lista-anexos]");
  const texto = form.querySelector("textarea[data-colar-anexos]");

  const mostrar = () => {
    lista.replaceChildren(...[...entrada.files].map((f, i) => {
      const li = document.createElement("li");
      li.textContent = `📎 ${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB) `;
      const remover = document.createElement("button");
      remover.type = "button";
      remover.className = "link";
      remover.textContent = "remover";
      remover.addEventListener("click", () => {
        const dt = new DataTransfer();
        [...entrada.files].forEach((g, j) => { if (j !== i) dt.items.add(g); });
        entrada.files = dt.files;
        mostrar();
      });
      li.append(remover);
      return li;
    }));
  };
  entrada.addEventListener("change", mostrar);

  texto?.addEventListener("paste", (e) => {
    const imagens = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!imagens.length) return;
    e.preventDefault();
    const dt = new DataTransfer();
    [...entrada.files].forEach((f) => dt.items.add(f));
    const hora = new Date().toLocaleTimeString("pt-BR").replaceAll(":", "");
    imagens.forEach((f, i) => {
      const ext = f.type.split("/")[1] === "jpeg" ? "jpg" : f.type.split("/")[1];
      dt.items.add(new File([f], `print-${hora}${imagens.length > 1 ? `-${i + 1}` : ""}.${ext}`, { type: f.type }));
    });
    entrada.files = dt.files;
    mostrar();
  });
}

// Selects que enviam o formulário ao mudar (filtro de cliente, escolha do solicitante).
for (const select of document.querySelectorAll("select[data-enviar-ao-mudar]")) {
  select.addEventListener("change", () => select.form.submit());
}
