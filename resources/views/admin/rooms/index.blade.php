@extends('layouts.admin')
@section('title', 'จัดการห้องพัก')

@section('content')
<div class="bg-white border-b border-gray-200 px-8 py-5 flex justify-between items-center sticky top-0 z-10">
    <div>
        <h1 class="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <i class="ph-fill ph-door text-line"></i> จัดการห้องพัก (Room Management)
        </h1>
        <p class="text-gray-500 text-sm mt-1">เพิ่ม แก้ไข หรือลบข้อมูลห้องพักและผู้เช่า</p>
    </div>
    <button onclick="document.getElementById('addRoomModal').classList.remove('hidden')" class="bg-line text-white px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-line-hover shadow-md flex items-center gap-2">
        <i class="ph ph-plus-circle text-lg"></i> เพิ่มห้องพักใหม่
    </button>
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
            <thead>
                <tr class="bg-gray-50 text-gray-500 text-sm border-b border-gray-200">
                    <th class="py-4 px-6 font-semibold">
                        <div class="flex items-center gap-1"><i class="ph ph-hash"></i> เลขห้อง</div>
                    </th>
                    <th class="py-4 px-6 font-semibold">
                        <div class="flex items-center gap-1"><i class="ph ph-info"></i> สถานะ</div>
                    </th>
                    <th class="py-4 px-6 font-semibold">
                        <div class="flex items-center gap-1"><i class="ph ph-user"></i> ข้อมูลผู้เช่า</div>
                    </th>
                    <th class="py-4 px-6 font-semibold">
                        <div class="flex items-center gap-1"><i class="ph ph-money"></i> ค่าเช่า & เงินประกัน</div>
                    </th>
                    <th class="py-4 px-6 font-semibold">
                        <div class="flex items-center gap-1"><i class="ph ph-gear"></i> จัดการ</div>
                    </th>
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 text-sm text-gray-700">
                @forelse($rooms as $room)
                <tr class="hover:bg-gray-50 transition">
                    <td class="py-4 px-6 font-bold text-gray-900">{{ $room->room_number }}</td>
                    <td class="py-4 px-6">
                        @if($room->tenant_name)
                            <span class="bg-blue-100 text-blue-600 px-2.5 py-1 rounded-full text-xs font-bold">มีผู้เช่า</span>
                        @else
                            <span class="bg-gray-100 text-gray-500 px-2.5 py-1 rounded-full text-xs font-bold">ว่าง</span>
                        @endif
                    </td>
                    <td class="py-4 px-6">
                        @if($room->tenant_name)
                            <div class="flex flex-col">
                                <span class="text-gray-900 font-bold">{{ $room->tenant_name }}</span>
                                <span class="text-gray-500 text-xs flex items-center gap-1 mt-0.5"><i class="ph ph-phone"></i> {{ $room->tenant_phone ?? '-' }}</span>
                                <span class="text-gray-400 text-[10px] font-mono mt-1">LINE: {{ $room->line_user_id ?? '-' }}</span>
                            </div>
                        @else
                            <span class="text-gray-400 italic">ว่าง</span>
                        @endif
                    </td>
                    <td class="py-4 px-6">
                        <div class="flex flex-col">
                            <span class="text-gray-900 font-medium">฿{{ number_format($room->monthly_rent) }}</span>
                            @if($room->deposit_amount > 0)
                                <span class="text-blue-500 text-xs mt-0.5">ประกัน: ฿{{ number_format($room->deposit_amount) }}</span>
                            @endif
                            @if($room->contract_start_date)
                                <span class="text-gray-400 text-[10px] mt-1">เริ่ม: {{ \Carbon\Carbon::parse($room->contract_start_date)->format('d/m/Y') }}</span>
                            @endif
                        </div>
                    </td>
                    <td class="py-4 px-6">
                        <div class="flex gap-3 items-center">
                            <button class="text-blue-600 hover:text-blue-800 font-medium" onclick="editRoom({{ $room }})">แก้ไข</button>
                            
                            @if($room->tenant_name)
                            <form action="{{ route('admin.rooms.checkout', $room->id) }}" method="POST" onsubmit="return confirm('ยืนยันการแจ้งย้ายออกสำหรับห้อง {{ $room->room_number }}?')">
                                @csrf
                                <button type="submit" class="text-orange-600 hover:text-orange-800 font-medium">แจ้งย้ายออก</button>
                            </form>
                            @endif

                            <form action="{{ route('admin.rooms.destroy', $room->id) }}" method="POST" onsubmit="return confirm('ยืนยันการลบห้อง {{ $room->room_number }}?')">
                                @csrf
                                @method('DELETE')
                                <button type="submit" class="text-red-600 hover:text-red-800 font-medium">ลบ</button>
                            </form>
                        </div>
                    </td>
                </tr>
                @empty
                <tr>
                    <td colspan="5" class="py-12 text-center text-gray-500 flex flex-col items-center">
                        <i class="ph ph-door text-5xl mb-3 opacity-20"></i>
                        ยังไม่มีข้อมูลห้องพักในระบบ
                    </td>
                </tr>
                @endforelse
            </tbody>
        </table>
    </div>
</div>

<!-- Add/Edit Room Modal -->
<div id="addRoomModal" class="fixed inset-0 bg-black/50 hidden items-center justify-center z-50 p-4">
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] overflow-y-auto">
        <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 sticky top-0 bg-white">
            <h3 id="modalTitle" class="font-bold text-lg text-gray-900">เพิ่มห้องพักใหม่</h3>
            <button onclick="document.getElementById('addRoomModal').classList.add('hidden')" class="text-gray-400 hover:text-gray-900"><i class="ph ph-x text-xl"></i></button>
        </div>
        <form id="roomForm" action="{{ route('admin.rooms.store') }}" method="POST" class="p-6 space-y-4">
            @csrf
            <div id="methodField"></div>
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">เลขห้อง</label>
                    <input type="text" name="room_number" id="room_number" class="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:border-line focus:ring-1 outline-none" placeholder="เช่น 101" required>
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">ค่าเช่า/เดือน (บาท)</label>
                    <input type="number" name="monthly_rent" id="monthly_rent" class="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:border-line focus:ring-1 outline-none" placeholder="4500" required>
                </div>
            </div>
            
            <div class="p-4 bg-blue-50 rounded-xl space-y-3">
                <p class="text-xs font-bold text-blue-600 uppercase tracking-wider">มิเตอร์เริ่มต้น (สำหรับบิลใบแรก)</p>
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">น้ำประปาเริ่มต้น</label>
                        <input type="number" name="initial_water_meter" id="initial_water_meter" class="w-full border border-gray-200 rounded-lg px-3 py-2 focus:border-line focus:ring-1 outline-none text-sm" value="0">
                    </div>
                    <div>
                        <label class="block text-xs font-medium text-gray-600 mb-1">ไฟฟ้าเริ่มต้น</label>
                        <input type="number" name="initial_electric_meter" id="initial_electric_meter" class="w-full border border-gray-200 rounded-lg px-3 py-2 focus:border-line focus:ring-1 outline-none text-sm" value="0">
                    </div>
                </div>
            </div>

            <hr class="border-gray-100">

            <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">ชื่อผู้เช่า (เว้นว่างไว้ถ้าห้องว่าง)</label>
                <input type="text" name="tenant_name" id="tenant_name" class="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:border-line focus:ring-1 outline-none" placeholder="เช่น คุณสมชาย">
            </div>
            
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">เบอร์โทรศัพท์</label>
                    <input type="text" name="tenant_phone" id="tenant_phone" class="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:border-line focus:ring-1 outline-none" placeholder="08x-xxx-xxxx">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">LINE User ID</label>
                    <input type="text" name="line_user_id" id="line_user_id" class="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:border-line focus:ring-1 outline-none" placeholder="U123...">
                </div>
            </div>

            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">วันที่เริ่มเข้าพัก</label>
                    <input type="date" name="contract_start_date" id="contract_start_date" class="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:border-line focus:ring-1 outline-none">
                </div>
                <div>
                    <label class="block text-sm font-medium text-gray-700 mb-1">เงินประกัน (บาท)</label>
                    <input type="number" name="deposit_amount" id="deposit_amount" class="w-full border border-gray-200 rounded-lg px-4 py-2.5 focus:border-line focus:ring-1 outline-none" placeholder="0">
                </div>
            </div>

            <div class="pt-4 flex gap-3">
                <button type="button" onclick="document.getElementById('addRoomModal').classList.add('hidden')" class="flex-1 bg-gray-100 text-gray-700 font-semibold py-3 rounded-xl hover:bg-gray-200 transition">ยกเลิก</button>
                <button type="submit" class="flex-1 bg-line text-white font-semibold py-3 rounded-xl hover:bg-line-hover transition shadow-lg shadow-line/30">บันทึกข้อมูล</button>
            </div>
        </form>
    </div>
</div>

<script>
    function editRoom(room) {
        document.getElementById('modalTitle').innerText = 'แก้ไขข้อมูลห้อง ' + room.room_number;
        document.getElementById('roomForm').action = '/admin/rooms/' + room.id;
        document.getElementById('methodField').innerHTML = '@method("PUT")';
        
        document.getElementById('room_number').value = room.room_number;
        document.getElementById('monthly_rent').value = room.monthly_rent;
        document.getElementById('initial_water_meter').value = room.initial_water_meter || 0;
        document.getElementById('initial_electric_meter').value = room.initial_electric_meter || 0;
        document.getElementById('tenant_name').value = room.tenant_name || '';
        document.getElementById('tenant_phone').value = room.tenant_phone || '';
        document.getElementById('line_user_id').value = room.line_user_id || '';
        document.getElementById('contract_start_date').value = room.contract_start_date || '';
        document.getElementById('deposit_amount').value = room.deposit_amount || 0;
        
        document.getElementById('addRoomModal').classList.remove('hidden');
    }
</script>
@endsection
