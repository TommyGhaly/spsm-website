"use client";

import { useCallback, useState } from "react";
import {
  describeOrderState,
  type OrderLookupResponse,
  type PublicOrderView,
} from "@spsm/shared";
import { money } from "./money";

/**
 * A buyer finding their own orders.
 *
 * ---------------------------------------------------------------------------
 * Why this is a form and not a sign-in.
 *
 * Nobody who buys from this bookstore has an account, and it is not an
 * oversight that can be fixed here. Authentication on this site is
 * Microsoft-only and restricted to the parish's Entra tenant — a parishioner
 * has no parish M365 address, so there is no credential for them to present and
 * no account for them to make. See src/lib/auth.ts.
 *
 * So the receipt is the credential. The order number and the email it was sent
 * to, together, prove the person is the buyer; the Function checks the pair and
 * then returns everything that address has bought. Both are required, always —
 * the email alone would let anyone who knows a parishioner's address list their
 * purchases, and the number alone would do the same to anyone who glanced at a
 * receipt.
 * ---------------------------------------------------------------------------
 */
export function OrderLookup() {
  const [orderId, setOrderId] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState<string | null>(null);
  const [orders, setOrders] = useState<PublicOrderView[] | null>(null);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      if (state === "loading") return;

      setState("loading");
      setError(null);

      try {
        const response = await fetch("/api/square/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: orderId.trim(), email: email.trim() }),
        });

        /*
         * Parsed before the status is looked at, because the useful sentence is
         * in the body on both paths. A 404 here carries the "check both against
         * your receipt" wording, and replacing it with a generic failure
         * message because the status was not 200 would throw away the only part
         * a buyer can act on.
         */
        const body = (await response.json()) as OrderLookupResponse;
        if (body.ok) {
          setOrders(body.orders);
        } else {
          setError(body.error);
          setOrders(null);
        }
      } catch {
        // A network failure, or the dev server with no Functions emulator
        // behind it — see the rewrite note in next.config.mjs.
        setError("Could not reach the church just now. Try again in a moment.");
        setOrders(null);
      } finally {
        setState("idle");
      }
    },
    [orderId, email, state],
  );

  return (
    <div className="orderfind">
      <form className="orderfind__form" onSubmit={submit}>
        <p className="orderfind__lead">
          Your order number is on the confirmation email the church sent you.
          Enter it with the address that email went to.
        </p>

        <label className="orderfind__field">
          <span className="orderfind__label">Order number</span>
          <input
            className="orderfind__input"
            value={orderId}
            onChange={(event) => setOrderId(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>

        <label className="orderfind__field">
          <span className="orderfind__label">Email</span>
          <input
            className="orderfind__input"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>

        <button className="orderfind__submit" type="submit" disabled={state === "loading"}>
          {state === "loading" ? "Looking…" : "Find my orders"}
        </button>

        {error && (
          <p className="orderfind__error" role="alert">
            {error}
          </p>
        )}
      </form>

      {orders && (
        <div className="orderfind__results">
          {orders.length === 0 ? (
            <p className="orderfind__empty">No orders under that address.</p>
          ) : (
            <>
              <h2 className="orderfind__count">
                {orders.length === 1 ? "One order" : `${orders.length} orders`}
              </h2>
              <ul className="orderfind__list">
                {orders.map((order) => (
                  <OrderCard key={order.orderId} order={order} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function OrderCard({ order }: { order: PublicOrderView }) {
  const placed = order.placedAt ? new Date(order.placedAt) : null;

  return (
    <li className="orderfind__order">
      <div className="orderfind__head">
        <div>
          <p className="orderfind__when">
            {placed
              ? placed.toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })
              : "Date unrecorded"}
          </p>
          {/* The name the order is filed under at the bookstore, so someone
              collecting for their family can see which of theirs this is. */}
          {order.buyerName && <p className="orderfind__who">{order.buyerName}</p>}
          {/* Shown because it is what the buyer has to quote to the office if
              anything is wrong with the order. */}
          <p className="orderfind__ref">{order.orderId}</p>
        </div>
        {/* No icon: `describeOrderState` already says "Posted" or "Waiting for
            you in the bookstore", and the icon set here has nothing that means
            either without a caption doing the work anyway. */}
        <p className={`orderfind__state orderfind__state--${order.status}`}>
          {describeOrderState(order)}
        </p>
      </div>

      <ul className="orderfind__lines">
        {order.lineItems.map((line, index) => (
          <li className="orderfind__line" key={`${order.orderId}-${index}`}>
            <span className="orderfind__linename">
              {line.quantity > 1 && <span className="orderfind__qty">{line.quantity}×</span>}
              {line.name}
            </span>
            {/* Null on orders taken before unit prices were recorded. Blank is
                honest; a computed guess would not be. */}
            {line.amount !== null && (
              <span className="orderfind__lineamount">{money(line.amount)}</span>
            )}
          </li>
        ))}
      </ul>

      <p className="orderfind__total">
        <span>Total</span>
        <strong>{money(order.total.amount, order.total.currency)}</strong>
      </p>

      {order.refunded && order.refundedAmount !== null && (
        <p className="orderfind__refund">{money(order.refundedAmount)} was refunded.</p>
      )}
    </li>
  );
}
