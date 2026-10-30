<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class InventoryBatch extends Model
{
    protected $fillable = [
        'product_id',
        'batch_code',
        'received_quantity',
        'remaining_quantity',
        'expiration_date',
        'note',
    ];

    protected function casts(): array
    {
        return [
            'received_quantity' => 'integer',
            'remaining_quantity' => 'integer',
            'expiration_date' => 'date',
        ];
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}
