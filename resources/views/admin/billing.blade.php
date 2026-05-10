@extends('layouts.admin')
@section('title', 'สร้างบิล')

@section('content')
<div class="bg-white border-b border-gray-200 px-8 py-5 flex justify-between items-center sticky top-0 z-10">
    <div>
        <h1 class="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <i class="ph-fill ph-receipt text-line"></i> สร้างบิลรายเดือน
        </h1>
        <p class="text-gray-500 text-sm mt-1">ประจำเดือน {{ now()->translatedFormat('F Y') }}</p>
    </div>
</div>

<div class="p-8 flex-1 max-w-7xl mx-auto w-full">
    <div class="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <form action="{{ route('admin.bills.generate') }}" method="POST">
            @csrf
            <table class="w-full text-left border-collapse">
                <thead>
                    <tr class="bg-gray-50 text-gray-500 text-sm border-b border-gray-200">
                        <th class="py-3 px-6 font-semibold">
                            <div class="flex items-center gap-1"><i class="ph ph-hash"></i> ห้อง</div>
                        </th>
                        <th class="py-3 px-6 font-semibold">
                            <div class="flex items-center gap-1"><i class="ph ph-user"></i> ผู้เช่า</div>
                        </th>
                        <th class="py-3 px-6 font-semibold">
                            <div class="flex items-center gap-1">
                                <i class="ph-fill ph-drop text-blue-500"></i> มิเตอร์น้ำ
                            </div>
                        </th>
                        <th class="py-3 px-6 font-semibold">
                            <div class="flex items-center gap-1">
                                <i class="ph-fill ph-lightning text-orange-500"></i> มิเตอร์ไฟ
                            </div>
                        </th>
                        <th class="py-3 px-6 font-semibold text-right">
                            <div class="flex items-center justify-end gap-1"><i class="ph ph-calc"></i> ยอดรวม</div>
                        </th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 text-sm text-gray-700">
                    @forelse($rooms ?? [] as $room)
                    @php
                        $prevWater = $room->bills()->latest()->first()->water_meter ?? 0;
                        $prevElectric = $room->bills()->latest()->first()->electric_meter ?? 0;
                        $rent = $room->monthly_rent;
                    @endphp
                    <tr class="hover:bg-gray-50 room-row" data-rent="{{ $rent }}" data-prev-water="{{ $prevWater }}" data-prev-electric="{{ $prevElectric }}">
                        <td class="py-4 px-6 font-bold text-gray-900">{{ $room->room_number }}</td>
                        <td class="py-4 px-6">{{ $room->tenant_name ?? 'ว่าง' }}</td>
                        <td class="py-4 px-6">
                            <div class="flex items-center gap-2">
                                <span class="text-gray-400 w-8">{{ $prevWater }}</span> 
                                <i class="ph ph-arrow-right text-gray-300"></i>
                                <input type="number" name="readings[{{ $room->id }}][water]" 
                                    class="w-20 border rounded px-2 py-1 focus:border-line focus:ring-1 outline-none water-input" 
                                    placeholder="เดือนนี้" required oninput="calculateRow(this)">
                                <span class="text-xs text-blue-500 bg-blue-50 px-2 py-1 rounded hidden water-units">0 หน่วย</span>
                            </div>
                        </td>
                        <td class="py-4 px-6">
                            <div class="flex items-center gap-2">
                                <span class="text-gray-400 w-8">{{ $prevElectric }}</span> 
                                <i class="ph ph-arrow-right text-gray-300"></i>
                                <input type="number" name="readings[{{ $room->id }}][electric]" 
                                    class="w-20 border rounded px-2 py-1 focus:border-line focus:ring-1 outline-none electric-input" 
                                    placeholder="เดือนนี้" required oninput="calculateRow(this)">
                                <span class="text-xs text-orange-500 bg-orange-50 px-2 py-1 rounded hidden electric-units">0 หน่วย</span>
                            </div>
                        </td>
                        <td class="py-4 px-6 text-right font-bold text-gray-900">
                            <span class="row-total">฿ {{ number_format($rent) }}</span>
                        </td>
                    </tr>
                    @empty
                    <tr>
                        <td colspan="5" class="py-8 text-center text-gray-500">ไม่พบข้อมูลห้องพัก กรุณาเพิ่มห้องในระบบก่อน</td>
                    </tr>
                    @endforelse
                </tbody>
            </table>
            
            @if(count($rooms ?? []) > 0)
            <div class="p-4 border-t border-gray-200 bg-gray-50 text-right flex justify-end">
                <button type="submit" class="bg-line text-white px-6 py-3 rounded-lg text-sm font-semibold hover:bg-line-hover shadow-md flex items-center gap-2 transition">
                    <i class="ph ph-paper-plane-tilt text-lg"></i> สร้างบิลและบันทึกข้อมูล
                </button>
            </div>
            @endif
        </form>
    </div>
</div>

<script>
    const WATER_RATE = {{ \App\Models\Setting::get('water_rate', 18) }};
    const ELECTRIC_RATE = {{ \App\Models\Setting::get('electric_rate', 8) }};

    function calculateRow(input) {
        const row = input.closest('.room-row');
        const rent = parseFloat(row.dataset.rent);
        const prevWater = parseFloat(row.dataset.prevWater);
        const prevElectric = parseFloat(row.dataset.prevElectric);

        const waterVal = parseFloat(row.querySelector('.water-input').value) || 0;
        const electricVal = parseFloat(row.querySelector('.electric-input').value) || 0;

        const waterUnits = Math.max(0, waterVal - prevWater);
        const electricUnits = Math.max(0, electricVal - prevElectric);

        // Update units display
        const waterUnitsSpan = row.querySelector('.water-units');
        if (waterVal > 0) {
            waterUnitsSpan.innerText = waterUnits + ' หน่วย';
            waterUnitsSpan.classList.remove('hidden');
        } else {
            waterUnitsSpan.classList.add('hidden');
        }

        const electricUnitsSpan = row.querySelector('.electric-units');
        if (electricVal > 0) {
            electricUnitsSpan.innerText = electricUnits + ' หน่วย';
            electricUnitsSpan.classList.remove('hidden');
        } else {
            electricUnitsSpan.classList.add('hidden');
        }

        // Calculate total
        const total = rent + (waterUnits * WATER_RATE) + (electricUnits * ELECTRIC_RATE);
        row.querySelector('.row-total').innerText = '฿ ' + total.toLocaleString();
    }
</script>
@endsection
