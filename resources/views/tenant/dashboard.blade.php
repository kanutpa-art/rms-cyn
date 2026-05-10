@extends('layouts.tenant')
@section('title', 'แดชบอร์ด')

@section('content')
<!-- Header Area -->
<div class="bg-line text-white p-5 rounded-b-[2rem] shadow-md pb-10">
    <div class="flex justify-between items-center mb-6">
        <h2 class="font-bold text-lg">บ้านพักสุขสันต์ (ห้อง {{ $tenant->activeContract->room->room_number ?? '101' }})</h2>
        <div class="w-10 h-10 bg-white/20 rounded-full flex items-center justify-center">
            <i class="ph ph-bell text-xl"></i>
        </div>
    </div>
    <p class="text-white/80 text-sm">สวัสดี, คุณ{{ $tenant->first_name ?? 'สมชาย' }}</p>
</div>

<!-- Main Body -->
<div class="px-5 -mt-8 flex-1 pb-8">
    
    <!-- Bill Status Card -->
    @if(isset($currentBill) || true) {{-- Defaulting to true for demo --}}
    <div class="bg-white rounded-2xl shadow-lg p-5 mb-6 border border-gray-100 relative overflow-hidden">
        @php $status = $currentBill->status ?? 'pending'; @endphp
        
        @if($status == 'overdue')
            <div class="absolute top-0 left-0 w-1 h-full bg-red-500"></div>
            <div class="flex justify-between items-center mb-2">
                <span class="text-gray-500 font-medium text-sm">บิลเดือน {{ $currentBill->billing_cycle ?? 'เม.ย. 69' }}</span>
                <span class="bg-red-100 text-red-600 text-xs px-2 py-1 rounded-full font-medium">ค้างชำระ</span>
            </div>
            <div class="text-3xl font-bold text-gray-900 mb-4">฿ {{ number_format($currentBill->total_amount ?? 4850, 2) }}</div>
        @elseif($status == 'pending')
            <div class="absolute top-0 left-0 w-1 h-full bg-orange-500"></div>
            <div class="flex justify-between items-center mb-2">
                <span class="text-gray-500 font-medium text-sm">บิลเดือน {{ $currentBill->billing_cycle ?? 'เม.ย. 69' }}</span>
                <span class="bg-orange-100 text-orange-600 text-xs px-2 py-1 rounded-full font-medium">รอชำระเงิน</span>
            </div>
            <div class="text-3xl font-bold text-gray-900 mb-4">฿ {{ number_format($currentBill->total_amount ?? 4850, 2) }}</div>
        @else
            <div class="absolute top-0 left-0 w-1 h-full bg-line"></div>
            <div class="flex justify-between items-center mb-2">
                <span class="text-gray-500 font-medium text-sm">บิลเดือน {{ $currentBill->billing_cycle ?? 'เม.ย. 69' }}</span>
                <span class="bg-green-100 text-green-600 text-xs px-2 py-1 rounded-full font-medium">ชำระแล้ว</span>
            </div>
            <div class="text-3xl font-bold text-gray-400 line-through mb-4">฿ {{ number_format($currentBill->total_amount ?? 4850, 2) }}</div>
        @endif

        @if(in_array($status, ['pending', 'overdue']))
        <div class="flex gap-3">
            <a href="#" class="flex-1 text-center bg-gray-100 text-gray-700 font-medium py-3 rounded-xl hover:bg-gray-200 transition text-sm">ดูรายละเอียด</a>
            <a href="#" class="flex-1 text-center bg-line text-white font-medium py-3 rounded-xl hover:bg-line-hover transition shadow-md shadow-line/30 text-sm">ชำระเงิน</a>
        </div>
        @endif
    </div>
    @else
    <div class="bg-white rounded-2xl shadow-sm p-8 mb-6 border border-gray-100 text-center">
        <i class="ph ph-check-circle text-4xl text-line mb-2"></i>
        <p class="text-gray-600 font-medium">ไม่มียอดค้างชำระ</p>
    </div>
    @endif

    <!-- Quick Actions -->
    <h3 class="text-gray-900 font-semibold mb-3 px-1">เมนูหลัก</h3>
    <div class="grid grid-cols-2 gap-4 mb-6">
        <a href="#" class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 text-center hover:border-line transition block group">
            <div class="bg-blue-50 w-12 h-12 mx-auto rounded-full flex items-center justify-center text-blue-500 mb-3 group-hover:scale-110 transition">
                <i class="ph-fill ph-drop text-2xl"></i>
            </div>
            <span class="text-sm font-medium text-gray-700">ส่งจดมิเตอร์</span>
        </a>
        <a href="#" class="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 text-center hover:border-line transition block group">
            <div class="bg-orange-50 w-12 h-12 mx-auto rounded-full flex items-center justify-center text-orange-500 mb-3 group-hover:scale-110 transition">
                <i class="ph-fill ph-wrench text-2xl"></i>
            </div>
            <span class="text-sm font-medium text-gray-700">แจ้งซ่อม</span>
        </a>
    </div>

</div>
@endsection
