// src/app/(auth)/layout.js
export default function AuthLayout({ children }) {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />
      <style>{`
        /* Reset global overrides for auth pages */
        .auth-shell,
        .auth-shell * {
          font-family: 'Plus Jakarta Sans', system-ui, sans-serif !important;
          box-sizing: border-box;
        }
        .auth-shell input:focus,
        .auth-shell textarea:focus,
        .auth-shell select:focus {
          outline: none !important;
          border-color: #D63B1F !important;
          box-shadow: 0 0 0 3px rgba(214,59,31,0.14) !important;
        }
        .auth-shell input::placeholder {
          color: #9B9890 !important;
        }
        .auth-shell .mono {
          font-family: 'JetBrains Mono', monospace !important;
        }
      `}</style>
      <div className="auth-shell">
        {children}
      </div>
    </>
  )
}
