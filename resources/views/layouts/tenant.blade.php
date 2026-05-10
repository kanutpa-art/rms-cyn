<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>ระบบผู้เช่า - @yield('title', 'Dormitory')</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/@phosphor-icons/web"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: { colors: { line: '#06C755', 'line-hover': '#05B34C', 'bg-light': '#F8FAFC' }, fontFamily: { sans: ['Prompt', 'sans-serif'] } }
            }
        }
    </script>
</head>
<body class="bg-gray-200 h-screen flex justify-center font-sans text-gray-800 overflow-hidden">
    <!-- Mobile Container mimicking LINE LIFF -->
    <div class="w-full max-w-md h-full bg-bg-light shadow-2xl flex flex-col relative overflow-y-auto">
        @yield('content')
    </div>
</body>
</html>
