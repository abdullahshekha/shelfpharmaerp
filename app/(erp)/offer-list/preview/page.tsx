export default function OfferListPreviewPage() {
  // Full preview is served directly by /api/offer-list/export
  // This page just redirects there for the active list
  return (
    <div className="flex items-center justify-center h-64 text-slate-400">
      <p>Redirecting to preview…</p>
      <script dangerouslySetInnerHTML={{ __html: `window.location.href = '/api/offer-list/export'` }} />
    </div>
  )
}
