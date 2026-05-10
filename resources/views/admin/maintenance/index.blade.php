@extends('layouts.admin')
@section('title', 'จัดการการแจ้งซ่อม')

@section('content')
<div class="bg-white border-b border-gray-200 px-8 py-5 flex justify-between items-center sticky top-0 z-10">
    <div>
        <h1 class="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <i class="ph-fill ph-wrench text-orange-500"></i> รายการแจ้งซ่อม
        </h1>
        <p class="text-gray-500 text-sm mt-1">ติดตามและอัปเดตสถานะการแจ้งซ่อมจากผู้เช่า</p>
    </div>
</div>

<div class="p-8 flex-1 max-w-7xl mx-auto w-full">
    @if(session('success'))
    <div class="bg-green-50 border border-green-200 text-green-700 px-6 py-4 rounded-xl mb-6 flex items-center gap-3">
        <i class="ph-fill ph-check-circle text-xl"></i>
        <span class="font-medium">{{ session('success') }}</span>
    </div>
    @endif

    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <table class="w-full text-left border-collapse">
            <thead>
                <tr class="bg-gray-50 text-gray-500 text-sm border-b border-gray-200">
                    <th class="py-4 px-6 font-semibold">ห้อง</th>
                    <th class="py-4 px-6 font-semibold">หัวข้อ / รายละเอียด</th>
                    <th class="py-4 px-6 font-semibold">วันที่แจ้ง</th>
                    <th class="py-4 px-6 font-semibold">สถานะ</th>
                    <th class="py-4 px-6 font-semibold">จัดการ</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 text-sm text-gray-700">
                @forelse($requests as $req)
                <tr class="hover:bg-gray-50 transition">
                    <td class="py-4 px-6 font-bold text-gray-900">ห้อง {{ $req->room->room_number }}</td>
                    <td class="py-4 px-6">
                        <p class="font-semibold text-gray-900">{{ $req->title }}</p>
                        <p class="text-gray-500 text-xs mt-1">{{ Str::limit($req->description, 50) }}</p>
                    </td>
                    <td class="py-4 px-6 text-gray-500">{{ $req->created_at->format('d/m/Y H:i') }}</td>
                    <td class="py-4 px-6">
                        @if($req->status == 'pending')
                            <span class="bg-orange-100 text-orange-600 px-2.5 py-1 rounded-full text-xs font-bold">รอรับเรื่อง</span>
                        @elseif($req->status == 'in_progress')
                            <span class="bg-blue-100 text-blue-600 px-2.5 py-1 rounded-full text-xs font-bold">กำลังดำเนินการ</span>
                        @else
                            <span class="bg-green-100 text-green-600 px-2.5 py-1 rounded-full text-xs font-bold">เสร็จสิ้น</span>
                        @endif
                    </td>
                    <td class="py-4 px-6">
                        <form action="{{ route('admin.maintenance.updateStatus', $req->id) }}" method="POST" class="flex items-center gap-2">
                            @csrf
                            @method('PATCH')
                            <select name="status" onchange="this.form.submit()" class="text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:border-line">
                                <option value="pending" {{ $req->status == 'pending' ? 'selected' : '' }}>รอรับเรื่อง</option>
                                <option value="in_progress" {{ $req->status == 'in_progress' ? 'selected' : '' }}>กำลังดำเนินการ</option>
                                <option value="completed" {{ $req->status == 'completed' ? 'selected' : '' }}>เสร็จสิ้น</option>
                            </select>
                        </form>
                    </td>
                </tr>
                @empty
                <tr>
                    <td colspan="5" class="py-12 text-center text-gray-500">
                        <i class="ph ph-wrench text-5xl mb-3 opacity-20"></i>
                        ไม่มีรายการแจ้งซ่อมในขณะนี้
                    </td>
                </tr>
                @endforelse
            </tbody>
        </table>
    </div>
</div>
@endsection
