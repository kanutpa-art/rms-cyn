@extends('layouts.admin')
@section('title', 'ภาพรวมระบบ')

@section('content')
<div class="bg-white border-b border-gray-200 px-8 py-5 flex justify-between items-center sticky top-0 z-10">
    <div>
        <h1 class="text-2xl font-bold text-gray-900">ภาพรวมระบบ (Overview)</h1>
        <p class="text-gray-500 text-sm mt-1">ประจำเดือน {{ now()->translatedFormat('F Y') }}</p>
    </div>
    <div class="flex items-center gap-4">
        <button class="bg-white border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2">
            <i class="ph ph-download-simple"></i> ส่งออกรายงาน
        </button>
        <div class="w-10 h-10 bg-line text-white rounded-full flex items-center justify-center font-bold">
            {{ substr(auth()->user()->name ?? 'A', 0, 1) }}
        </div>
    </div>
</div>

<div class="p-8 flex-1 max-w-7xl mx-auto w-full">
    <!-- แจ้งเตือน -->
    @if(session('success'))
    <div class="bg-green-50 border border-green-200 text-green-700 px-6 py-4 rounded-xl mb-6 flex items-center gap-3">
        <i class="ph-fill ph-check-circle text-xl"></i>
        <span class="font-medium">{{ session('success') }}</span>
    </div>
    @endif

    <!-- Stats Row -->
    <div class="grid grid-cols-4 gap-6 mb-8">
        <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col">
            <div class="flex justify-between items-start mb-2">
                <h3 class="text-gray-500 text-sm font-medium">รายรับเดือนนี้ (จ่ายแล้ว)</h3>
                <div class="p-2 bg-green-50 text-green-600 rounded-lg"><i class="ph ph-money text-xl"></i></div>
            </div>
            <div class="text-3xl font-bold text-gray-900 mt-2">฿ {{ number_format($revenue ?? 0) }}</div>
        </div>
        
        <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col">
            <div class="flex justify-between items-start mb-2">
                <h3 class="text-gray-500 text-sm font-medium">ยอดค้างชำระ (รอจ่าย)</h3>
                <div class="p-2 bg-red-50 text-red-600 rounded-lg"><i class="ph ph-warning-circle text-xl"></i></div>
            </div>
            <div class="text-3xl font-bold text-red-500 mt-2">฿ {{ number_format($overdueAmount ?? 0) }}</div>
            <p class="text-gray-500 text-sm mt-auto pt-4 flex items-center gap-1"><span class="font-medium text-gray-900">{{ $overdueCount ?? 0 }} ห้อง</span> ที่ยังไม่ชำระ</p>
        </div>

        <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col">
            <div class="flex justify-between items-start mb-2">
                <h3 class="text-gray-500 text-sm font-medium">อัตราการเช่า</h3>
                <div class="p-2 bg-blue-50 text-blue-600 rounded-lg"><i class="ph ph-door text-xl"></i></div>
            </div>
            <div class="text-3xl font-bold text-gray-900 mt-2">{{ $occupiedRooms ?? 0 }}/{{ $totalRooms ?? 0 }}</div>
            <p class="text-gray-500 text-sm mt-auto pt-4 flex items-center gap-1">ห้องว่าง <span class="font-medium text-blue-600">{{ $vacantRooms ?? 0 }} ห้อง</span></p>
        </div>

        <div class="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col">
            <div class="flex justify-between items-start mb-2">
                <h3 class="text-gray-500 text-sm font-medium">แจ้งซ่อมรอดำเนินการ</h3>
                <div class="p-2 bg-orange-50 text-orange-600 rounded-lg"><i class="ph ph-wrench text-xl"></i></div>
            </div>
            <div class="text-3xl font-bold text-gray-900 mt-2">{{ $pendingMaintenanceCount ?? 0 }}</div>
            <p class="text-orange-500 text-sm mt-auto pt-4 flex items-center gap-1 font-medium"><i class="ph ph-clock"></i> ต้องการตรวจสอบ</p>
        </div>
    </div>
    
    <!-- Tables -->
    <div class="grid grid-cols-2 gap-6">
        <!-- Slips -->
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden col-span-2">
            <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h2 class="font-bold text-gray-900 flex items-center gap-2"><i class="ph-fill ph-file-search text-line"></i> บิลที่รอการชำระเงิน (คลิกอนุมัติเมื่อตรวจสลิปใน LINE แล้ว)</h2>
            </div>
            <div class="divide-y divide-gray-100">
                @forelse($pendingBills ?? [] as $bill)
                    <div class="p-4 px-6 flex items-center justify-between hover:bg-gray-50">
                        <div class="flex items-center gap-4">
                            <div class="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
                                <i class="ph ph-file-text text-gray-400 text-xl"></i>
                            </div>
                            <div>
                                <p class="font-semibold text-gray-900">ห้อง {{ $bill->room->room_number ?? '-' }} - {{ $bill->room->tenant_name ?? 'ไม่มีชื่อ' }}</p>
                                <p class="text-xs text-gray-500">บิลรอบเดือน {{ $bill->billing_month }}</p>
                            </div>
                        </div>
                        <div class="text-right flex items-center gap-4">
                            <p class="font-bold text-gray-900 text-lg">฿ {{ number_format($bill->total_amount) }}</p>
                            <form action="{{ route('admin.bills.pay', $bill->id) }}" method="POST">
                                @csrf
                                <button type="submit" onclick="return confirm('ยืนยันว่าได้รับยอดเงินจากห้อง {{ $bill->room->room_number }} เรียบร้อยแล้ว?')" class="px-4 py-2 bg-green-100 text-green-700 text-sm font-semibold rounded-lg hover:bg-green-200 transition">ได้รับเงินแล้ว</button>
                            </form>
                        </div>
                    </div>
                @empty
                    <div class="p-8 text-center text-gray-500">ไม่มีบิลค้างชำระในระบบ เยี่ยมมาก! 🎉</div>
                @endforelse
            </div>
        </div>
    </div>
</div>
@endsection
