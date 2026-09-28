/* Кредит: одна арифметика на весь сайт.
   Заказчик 2026-09-29: «на странице автомобилей написано лизинг и платёж от. сделай так чтобы там
   был не лизинг а кредит и платёж считают от цены машины на максимальный срок и участие клиента
   20%. в блок кредитный калькулятор добавь ползунок участие клиента от 5% до 80%».

   Отсюда три величины, которые обязаны совпадать в карточке автомобиля (сервер считает платёж при
   рендере) и в /kalkulyator (клиент пересчитывает при движении ползунков):
     • RATE_PERCENT   — ставка «под капотом»: 16 % годовых (поле «Ставка» убрано из формы);
     • MONTHS_MAX     — максимальный срок, он же верхняя граница ползунка «Срок, месяцев»;
     • SHARE_DEFAULT  — участие клиента по умолчанию: 20 % от цены, как в подписи карточки;
     • SHARE_MIN/MAX  — границы ползунка «Участие клиента, %».
   Формула — аннуитет; при нулевой сумме кредита платёж 0, а не деление на ноль. */

export const RATE_PERCENT = 16;
export const MONTHS_MAX = 84;
export const SHARE_DEFAULT = 20;
export const SHARE_MIN = 5;
export const SHARE_MAX = 80;

/** Ежемесячный платёж по аннуитету: сумма кредита, срок в месяцах, ставка в % годовых. */
export function monthlyPayment(credit, months, ratePercent = RATE_PERCENT) {
  const sum = Math.max(0, Number(credit) || 0);
  const n = Math.max(1, Math.round(Number(months) || 0));
  if (sum <= 0) return 0;
  const m = (Number(ratePercent) || 0) / 100 / 12;
  return m > 0 ? (sum * m) / (1 - Math.pow(1 + m, -n)) : sum / n;
}

/** Сумма кредита для цены автомобиля и участия клиента в процентах. */
export function creditFor(price, sharePercent = SHARE_DEFAULT) {
  return Math.max(0, Math.round(Number(price) || 0) * (1 - (Number(sharePercent) || 0) / 100));
}

/** Платёж карточки автомобиля: полная цена, максимальный срок, участие клиента 20 %. */
export function carPagePayment(price, sharePercent = SHARE_DEFAULT, months = MONTHS_MAX) {
  return Math.round(monthlyPayment(creditFor(price, sharePercent), months));
}
