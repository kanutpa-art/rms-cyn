@extends('layouts.admin')
@section('title', 'ตั้งค่าระบบ')

@section('content')
<div class="bg-white border-b border-gray-200 px-8 py-5 flex justify-between items-center sticky top-0 z-10">
    <div>
        <h1 class="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <i class="ph-fill ph-gear text-gray-700"></i> ตั้งค่าระบบ (Settings)
        </h1>
        <p class="text-gray-500 text-sm mt-1">กำหนดอัตราค่าบริการและข้อมูลพื้นฐานของหอพัก</p>
    </div>
</div>

<div class="p-8 flex-1 max-w-3xl mx-auto w-full">
    @if(session('success'))
    <div class="bg-green-50 border border-green-200 text-green-700 px-6 py-4 rounded-xl mb-6 flex items-center gap-3">
        <i class="ph-fill ph-check-circle text-xl"></i>
        <span class="font-medium">{{ session('success') }}</span>
    </div>
    @endif

    <form action="{{ route('admin.settings.store') }}" method="POST" class="space-y-6">
        @csrf
        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
            <h2 class="text-lg font-bold text-gray-900 flex items-center gap-2 border-b border-gray-100 pb-4">
                <i class="ph ph-lightning text-orange-500"></i> อัตราค่าสาธารณูปโภค
            </h2>
            
            <div class="grid grid-cols-2 gap-6">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">ค่าน้ำประปา (บาท/หน่วย)</label>
                    <input type="number" name="water_rate" value="{{ $settings['water_rate'] ?? 18 }}" class="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:border-line focus:ring-1 outline-none" required>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">ค่าไฟฟ้า (บาท/หน่วย)</label>
                    <input type="number" name="electric_rate" value="{{ $settings['electric_rate'] ?? 8 }}" class="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:border-line focus:ring-1 outline-none" required>
                </div>
            </div>
        </div>

        <div class="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
            <h2 class="text-lg font-bold text-gray-900 flex items-center gap-2 border-b border-gray-100 pb-4">
                <i class="ph ph-buildings text-line"></i> ข้อมูลหอพัก
            </h2>
            
            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">ชื่อหอพัก / อาคาร</label>
                <input type="text" name="dorm_name" value="{{ $settings['dorm_name'] ?? 'หอพักสุขสบาย' }}" class="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:border-line focus:ring-1 outline-none">
            </div>

            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">เบอร์โทรศัพท์ติดต่อ</label>
                <input type="text" name="contact_phone" value="{{ $settings['contact_phone'] ?? '08x-xxx-xxxx' }}" class="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:border-line focus:ring-1 outline-none">
            </div>
        </div>

        <div class="flex justify-end">
            <button type="submit" class="bg-line text-white px-8 py-3 rounded-xl font-bold hover:bg-line-hover shadow-lg shadow-line/30 transition">
                บันทึกการตั้งค่าทั้งหมด
            </button>
        </div>
    </form>
</div>
@endsection
