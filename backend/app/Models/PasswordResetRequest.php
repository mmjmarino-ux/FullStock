<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PasswordResetRequest extends Model
{
    protected $fillable = [
        'email',
        'message',
        'status',
        'reviewed_by',
        'reviewed_at',
    ];

    protected function casts(): array
    {
        return [
            'reviewed_at' => 'datetime',
        ];
    }
}