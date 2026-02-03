export default function SkeletonLoader({ type = 'default' }) {
  if (type === 'dashboard') {
    return (
      <div className="flex h-screen bg-gray-50">
        {/* Conversations Sidebar */}
        <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
          <div className="p-4 border-b border-gray-200">
            <div className="h-6 bg-gray-200 rounded w-24 mb-2 animate-pulse"></div>
            <div className="h-4 bg-gray-200 rounded w-32 mb-4 animate-pulse"></div>
            
            {/* Filter tabs skeleton */}
            <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-6 bg-gray-200 rounded w-12 animate-pulse"></div>
              ))}
            </div>
          </div>
          
          <div className="flex-1 p-4 space-y-4">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="flex items-center space-x-3 animate-pulse">
                <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded w-32 mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-48"></div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 bg-gray-200 rounded-full mx-auto mb-4 animate-pulse"></div>
            <div className="h-6 bg-gray-200 rounded w-48 mx-auto mb-2 animate-pulse"></div>
            <div className="h-4 bg-gray-200 rounded w-64 mx-auto animate-pulse"></div>
          </div>
        </div>
      </div>
    )
  }

  if (type === 'conversations') {
    return (
      <div className="p-4 space-y-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex items-center space-x-3 animate-pulse">
            <div className="w-10 h-10 bg-gray-200 rounded-full"></div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                <div className="h-4 bg-gray-200 rounded w-32"></div>
                <div className="h-3 bg-gray-200 rounded w-12"></div>
              </div>
              <div className="h-3 bg-gray-200 rounded w-48"></div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (type === 'messages') {
    return (
      <div className="space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className={`flex ${i % 2 === 0 ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-xs animate-pulse ${i % 2 === 0 ? 'bg-blue-200' : 'bg-gray-200'} rounded-2xl p-4`}>
              <div className="h-4 bg-gray-300 rounded w-32 mb-2"></div>
              <div className="h-4 bg-gray-300 rounded w-24"></div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
      <div className="h-4 bg-gray-200 rounded w-1/2"></div>
    </div>
  )
}