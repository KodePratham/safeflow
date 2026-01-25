import Link from 'next/link';

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-200 py-4 px-6">
        <div className="max-w-4xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold text-orange-500">SafeFlow</h1>
          <nav className="flex gap-6">
            <Link href="/admin" className="text-gray-600 hover:text-orange-500 transition-colors">
              Admin
            </Link>
            <Link href="/verify" className="text-gray-600 hover:text-orange-500 transition-colors">
              Verify
            </Link>
          </nav>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-xl text-center">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Developer Payments
          </h2>
          <p className="text-lg text-gray-600 mb-8">
            Stream USDC payments to developers on Stacks. 
            Bridge from Ethereum, set drip rates, and let recipients claim anytime.
          </p>
          
          <div className="flex gap-4 justify-center">
            <Link href="/admin" className="btn-primary">
              Create Payment
            </Link>
            <Link href="/verify" className="btn-secondary">
              Check Status
            </Link>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 py-6 px-6">
        <div className="max-w-4xl mx-auto text-center text-sm text-gray-500">
          <p>SafeFlow — USDCx on Stacks</p>
        </div>
      </footer>
    </div>
  );
}
