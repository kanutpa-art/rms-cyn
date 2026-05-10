<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MaintenanceRequest extends Model
{
    protected $fillable = [
        'room_id',
        'title',
        'description',
        'status',
        'image_path',
    ];

    public function room(): BelongsTo
    {
        return $this->belongsTo(Room::class);
    }
}
