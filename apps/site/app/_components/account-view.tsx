"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Client-side account and library views.
 *
 * Rendered in the browser rather than on the server because the session lives
 * in an HttpOnly cookie the browser already holds — server-rendering these
 * would mean forwarding that cookie through the site process for no benefit.
 */

interface Me {
  authenticated: boolean;
  userId?: string;
  verified?: boolean;
  status?: string;
}

interface Entitlement {
  episodeId: string;
  status: string;
  grantedAt: string;
  active: boolean;
}

interface Device {
  id: string;
  label: string;
  platform: string;
  lastSeenAt: string;
  revokedAt: string | null;
}

function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/v1/me", { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((data: Me) => setMe(data))
      .catch(() => setMe({ authenticated: false }))
      .finally(() => setLoading(false));
  }, []);

  return { me, loading };
}

function SignedOut({ what }: { what: string }) {
  return (
    <div className="notice">
      <strong>You are not signed in.</strong> {what}
      <p className="cta-row" style={{ marginTop: "1rem" }}>
        <a className="button button--primary" href="/login">
          Sign in
        </a>
        <a className="button button--ghost" href="/register">
          Create an account
        </a>
      </p>
    </div>
  );
}

export function AccountView() {
  const { me, loading } = useMe();
  const [devices, setDevices] = useState<Device[]>([]);

  const loadDevices = useCallback(() => {
    fetch("/api/v1/me/devices", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { devices: [] }))
      .then((d: { devices: Device[] }) => setDevices(d.devices ?? []))
      .catch(() => setDevices([]));
  }, []);

  useEffect(() => {
    if (me?.authenticated) loadDevices();
  }, [me, loadDevices]);

  async function signOut() {
    await fetch("/api/v1/auth/sign-out", { method: "POST", credentials: "include" });
    window.location.assign("/");
  }

  async function revoke(id: string) {
    await fetch(`/api/v1/me/devices/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "include",
    });
    loadDevices();
  }

  if (loading) return <p>Loading…</p>;
  if (!me?.authenticated) return <SignedOut what="Sign in to see your account." />;

  return (
    <>
      <table className="table">
        <tbody>
          <tr>
            <td>Status</td>
            <td>{me.status}</td>
          </tr>
          <tr>
            <td>Email verified</td>
            <td style={{ color: me.verified ? "var(--success)" : "var(--warning)" }}>
              {me.verified ? "yes" : "not yet — multiplayer is locked until you verify"}
            </td>
          </tr>
        </tbody>
      </table>

      <h3>Devices</h3>
      <p>
        Devices are remembered so you can play offline. There is no hardware fingerprinting; revoke
        anything you do not recognise.
      </p>
      {devices.length === 0 ? (
        <p>No devices remembered yet.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Device</th>
              <th>Platform</th>
              <th>Last seen</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr key={device.id}>
                <td>{device.label}</td>
                <td>{device.platform}</td>
                <td>{device.lastSeenAt?.slice(0, 10)}</td>
                <td>
                  {device.revokedAt ? (
                    <span style={{ color: "var(--bone-300)" }}>revoked</span>
                  ) : (
                    <button className="linklike" onClick={() => revoke(device.id)}>
                      Revoke
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h3>Elsewhere</h3>
      <ul>
        <li>
          <a href="/library">Your library</a>
        </li>
        <li>
          <a href="/orders">Your orders</a>
        </li>
        <li>
          <a href="/support">Support</a>
        </li>
      </ul>

      <p className="cta-row">
        <button className="button button--ghost" onClick={signOut}>
          Sign out
        </button>
      </p>
    </>
  );
}

export function LibraryView() {
  const { me, loading } = useMe();
  const [items, setItems] = useState<Entitlement[] | null>(null);

  useEffect(() => {
    if (!me?.authenticated) return;
    fetch("/api/v1/me/entitlements", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { entitlements: [] }))
      .then((d: { entitlements: Entitlement[] }) => setItems(d.entitlements ?? []))
      .catch(() => setItems([]));
  }, [me]);

  if (loading) return <p>Loading…</p>;
  if (!me?.authenticated) return <SignedOut what="Sign in to see what you own." />;
  if (items === null) return <p>Loading your library…</p>;

  if (items.length === 0) {
    return (
      <>
        <p>You do not own any episodes yet.</p>
        <p className="cta-row">
          <a className="button button--primary" href="/play?mode=demo">
            Play the free demo
          </a>
          <a className="button button--ghost" href="/episodes/false-dawn">
            Episode 1
          </a>
        </p>
        <p>
          Multiplayer is free and does not need a purchase &mdash;{" "}
          <a href="/multiplayer">play it now</a>.
        </p>
      </>
    );
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Episode</th>
          <th>Status</th>
          <th>Owned since</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.episodeId}>
            <td>{item.episodeId}</td>
            <td style={{ color: item.active ? "var(--success)" : "var(--warning)" }}>
              {item.status}
            </td>
            <td>{item.grantedAt?.slice(0, 10)}</td>
            <td>{item.active ? <a href="/play">Play</a> : <a href="/support">Support</a>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function OrdersView() {
  const { me, loading } = useMe();
  const [orders, setOrders] = useState<
    { id: string; status: string; total: number; currency: string; createdAt: string }[] | null
  >(null);

  useEffect(() => {
    if (!me?.authenticated) return;
    fetch("/api/v1/me/orders", { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { orders: [] }))
      .then((d: { orders: [] }) => setOrders(d.orders ?? []))
      .catch(() => setOrders([]));
  }, [me]);

  if (loading) return <p>Loading…</p>;
  if (!me?.authenticated) return <SignedOut what="Sign in to see your orders." />;
  if (orders === null) return <p>Loading…</p>;
  if (orders.length === 0) return <p>No orders yet.</p>;

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Order</th>
          <th>Status</th>
          <th>Total</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => (
          <tr key={order.id}>
            <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>{order.id}</td>
            <td>{order.status}</td>
            <td>
              {(order.total / 100).toFixed(2)} {order.currency}
            </td>
            <td>{order.createdAt?.slice(0, 10)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
