<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\MaintenanceRequest;
use App\Models\Room;

class MaintenanceController extends Controller
{
    /**
     * สำหรับแอดมิน: ดูรายการแจ้งซ่อมทั้งหมด
     */
    public function index()
    {
        $requests = MaintenanceRequest::with('room')->orderBy('created_at', 'desc')->get();
        return view('admin.maintenance.index', compact('requests'));
    }

    /**
     * สำหรับผู้เช่า: บันทึกการแจ้งซ่อม
     */
    public function store(Request $request)
    {
        $request->validate([
            'room_id' => 'required|exists:rooms,id',
            'title' => 'required|string|max:255',
            'description' => 'required|string',
            'image' => 'nullable|image|max:2048',
        ]);

        $data = $request->only(['room_id', 'title', 'description']);
        
        if ($request->hasFile('image')) {
            $data['image_path'] = $request->file('image')->store('maintenance', 'public');
        }

        MaintenanceRequest::create($data);

        return redirect()->back()->with('success', 'บันทึกการแจ้งซ่อมเรียบร้อยแล้ว');
    }

    /**
     * สำหรับแอดมิน: อัปเดตสถานะการซ่อม
     */
    public function updateStatus(Request $request, MaintenanceRequest $maintenanceRequest)
    {
        $request->validate([
            'status' => 'required|in:pending,in_progress,completed',
        ]);

        $maintenanceRequest->update(['status' => $request->status]);

        return redirect()->back()->with('success', 'อัปเดตสถานะการแจ้งซ่อมเรียบร้อยแล้ว');
    }
}
