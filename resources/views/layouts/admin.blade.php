<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin - @yield('title', 'Dormitory System')</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/@phosphor-icons/web"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    colors: { line: '#06C755', 'line-hover': '#05B34C', 'bg-light': '#F8FAFC' },
                    fontFamily: { sans: ['Prompt', 'sans-serif'] }
                }
            }
        }
    </script>
</head>
<body class="bg-gray-100 h-screen flex overflow-hidden font-sans text-gray-800">
    <!-- Sidebar -->
    <div class="w-64 bg-white border-r border-gray-200 flex flex-col shadow-sm z-20">
        <div class="p-6 border-b border-gray-100">
            <h1 class="text-xl font-bold text-gray-900 flex items-center gap-2">
                <i class="ph-fill ph-buildings text-line text-2xl"></i> RMS Admin
            </h1>
        </div>
        <div class="flex-1 overflow-y-auto py-4">
            <div class="px-4 mb-2 text-xs font-bold text-gray-400 uppercase tracking-wider">Main Menu</div>
            <a href="/admin/dashboard" class="w-full text-left px-6 py-3 text-sm hover:bg-gray-50 flex items-center gap-3 {{ request()->is('admin/dashboard') ? 'bg-gray-50 text-line font-semibold' : 'text-gray-700' }}">
                <i class="ph ph-desktop text-lg"></i> ภาพรวม (Dashboard)
            </a>
            <a href="/admin/rooms" class="w-full text-left px-6 py-3 text-sm hover:bg-gray-50 flex items-center gap-3 {{ request()->is('admin/rooms*') ? 'bg-gray-50 text-line font-semibold' : 'text-gray-700' }}">
                <i class="ph ph-door text-lg"></i> จัดการห้อง
            </a>
            <a href="/admin/billing" class="w-full text-left px-6 py-3 text-sm hover:bg-gray-50 flex items-center gap-3 {{ request()->is('admin/billing') ? 'bg-gray-50 text-line font-semibold' : 'text-gray-700' }}">
                <i class="ph ph-receipt text-lg"></i> สร้างบิล
            </a>
            <a href="/admin/payments" class="w-full text-left px-6 py-3 text-sm hover:bg-gray-50 flex items-center gap-3 {{ request()->is('admin/payments') ? 'bg-gray-50 text-line font-semibold' : 'text-gray-700' }}">
                <i class="ph ph-money text-lg"></i> ตรวจสอบสลิป
            </a>
            <a href="/admin/settings" class="w-full text-left px-6 py-3 text-sm hover:bg-gray-50 flex items-center gap-3 {{ request()->is('admin/settings') ? 'bg-gray-50 text-line font-semibold' : 'text-gray-700' }}">
                <i class="ph ph-gear text-lg"></i> ตั้งค่าระบบ
            </a>
        </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col h-full bg-bg-light overflow-y-auto relative">
        @yield('content')
    </div>
</body>
</html>
