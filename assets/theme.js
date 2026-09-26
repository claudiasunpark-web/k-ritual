(() => {
  // Session (variant) picker on the class page: keeps the hidden variant id,
  // the price and the enroll button in sync with the selected session.
  document.querySelectorAll('[data-course-section]').forEach((section) => {
    const form = section.querySelector('.course-form');
    if (!form) return;

    const idInput = form.querySelector('[data-variant-input]');
    const button = form.querySelector('[data-add-button]');
    const priceWrapper = section.querySelector('[data-price-wrapper] [data-price]');

    form.querySelectorAll('.session-option input[type="radio"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        idInput.value = radio.value;

        if (priceWrapper) {
          const compare = radio.dataset.comparePrice;
          priceWrapper.classList.toggle('price--sale', Boolean(compare));
          priceWrapper.innerHTML =
            (compare ? `<s class="price__compare">${compare}</s>` : '') +
            `<span class="price__current">${radio.dataset.price}</span>`;
        }

        if (button) {
          button.disabled = radio.disabled;
          button.textContent = radio.disabled ? button.dataset.labelSoldOut : button.dataset.labelEnroll;
        }

        const url = new URL(window.location.href);
        url.searchParams.set('variant', radio.value);
        window.history.replaceState({}, '', url.toString());
      });
    });
  });

  // Cart: submit quantity changes automatically.
  document.querySelectorAll('[data-auto-submit]').forEach((input) => {
    input.addEventListener('change', () => input.form && input.form.submit());
  });
})();
