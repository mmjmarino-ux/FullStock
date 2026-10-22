<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\Sale;
use App\Models\Supplier;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

class AssistantTest extends TestCase
{
    use RefreshDatabase;

    public function test_assistant_uses_live_workspace_records_and_returns_the_model_answer(): void
    {
        config()->set('services.ai.provider', 'openai');
        config()->set('services.openai.key', 'test-api-key');
        config()->set('services.openai.model', 'test-model');

        Http::fake([
            'https://api.openai.com/v1/responses' => Http::response([
                'output' => [[
                    'type' => 'message',
                    'role' => 'assistant',
                    'content' => [['type' => 'output_text', 'text' => 'Akitakomachi Rice has 4 units, so it is low stock.']],
                ]],
            ]),
        ]);

        $admin = User::factory()->create(['role' => 'Administrator']);
        $supplier = Supplier::create([
            'name' => 'Rice Supply Co.',
            'contact' => '09170000000',
            'email' => 'supplier@example.test',
            'products' => 'Rice',
        ]);
        $product = Product::create([
            'name' => 'Akitakomachi Rice',
            'category' => 'Short-Grain Rice',
            'price' => 100,
            'stock' => 4,
            'reorder_level' => 5,
            'supplier_id' => $supplier->id,
        ]);
        $sale = Sale::create([
            'sale_number' => 'S-00001',
            'total' => 200,
            'status' => 'Completed',
            'sold_at' => now(),
        ]);
        $sale->items()->create([
            'product_id' => $product->id,
            'product_name' => $product->name,
            'quantity' => 2,
            'unit_price' => 100,
            'line_total' => 200,
        ]);

        Sanctum::actingAs($admin);

        $this->postJson('/api/assistant', [
            'question' => 'Give me the saved price and quantity for Akitakomachi Rice.',
            'conversation' => [
                ['role' => 'user', 'text' => 'What is the stock level?'],
                ['role' => 'assistant', 'text' => 'I am checking the live record.'],
            ],
        ])->assertOk()->assertJson([
            'answer' => 'Akitakomachi Rice has 4 units, so it is low stock.',
        ]);

        Http::assertSent(function ($request): bool {
            $instructions = $request['instructions'];

            return $request->url() === 'https://api.openai.com/v1/responses'
                && $request->hasHeader('Authorization', 'Bearer test-api-key')
                && $request['model'] === 'test-model'
                && $request['store'] === false
                && str_contains($instructions, 'Akitakomachi Rice')
                && str_contains($instructions, '"price_php":100')
                && str_contains($instructions, '"stock_units":4')
                && ! str_contains($instructions, 'Rice Supply Co.')
                && ! str_contains($instructions, '"revenue_php":200')
                && str_contains($request['input'], 'What is the stock level?');
        });
    }

    public function test_low_stock_question_returns_live_product_data_without_waiting_for_the_model(): void
    {
        config()->set('services.ai.provider', 'ollama');
        config()->set('services.ollama.model', 'qwen3:4b-instruct');
        Http::fake();

        $admin = User::factory()->create(['role' => 'Administrator']);
        Product::create([
            'name' => 'Akitakomachi Rice',
            'category' => 'Short-Grain Rice',
            'price' => 100,
            'stock' => 4,
            'reorder_level' => 5,
        ]);
        Product::create([
            'name' => 'Calrose Rice',
            'category' => 'Medium-Grain Rice',
            'price' => 100,
            'stock' => 20,
            'reorder_level' => 5,
        ]);
        Sanctum::actingAs($admin);

        $this->postJson('/api/assistant', [
            'question' => 'Which products are low stock right now?',
        ])->assertOk()->assertJson([
            'answer' => "Current low-stock products (stock at or below the reorder level):\n- Akitakomachi Rice: 4 units in stock (reorder level: 5).",
        ]);

        Http::assertNothingSent();
    }

    public function test_assistant_reports_missing_provider_configuration_without_local_fallback(): void
    {
        config()->set('services.ai.provider', 'openai');
        config()->set('services.openai.key', '');
        Http::fake();

        Sanctum::actingAs(User::factory()->create(['role' => 'Staff']));

        $response = $this->postJson('/api/assistant', ['question' => 'How much rice do we have?']);
        $response->assertStatus(503)->assertJsonStructure(['message']);
        $this->assertStringContainsString('OPENAI_API_KEY', $response->json('message'));

        Http::assertNothingSent();
    }

    public function test_assistant_can_use_local_ollama_without_an_api_key(): void
    {
        config()->set('services.ai.provider', 'ollama');
        config()->set('services.ollama.model', 'qwen3:4b-instruct');
        config()->set('services.openai.key', '');

        Http::fake([
            'http://127.0.0.1:11434/api/chat' => Http::response([
                'message' => [
                    'role' => 'assistant',
                    'content' => 'Staff record the sale using the administrator-managed catalog price.',
                ],
                'done' => true,
            ]),
        ]);

        $admin = User::factory()->create(['role' => 'Administrator']);
        Sanctum::actingAs($admin);

        $response = $this->postJson('/api/assistant', [
            'question' => 'Summarize the purpose and limits of the AI assistant for this business.',
            'conversation' => [['role' => 'user', 'text' => 'Is the catalog price controlled by the admin?']],
        ]);

        $response->assertOk();
        $streamed = $response->streamedContent();
        $this->assertStringContainsString('Staff record the sale using the administrator-managed catalog price.', $streamed);
        $this->assertStringContainsString('"done":true', $streamed);

        Http::assertSent(function ($request): bool {
            $messages = $request['messages'];
            $systemMessage = $messages[0]['content'] ?? '';

            return $request->url() === 'http://127.0.0.1:11434/api/chat'
                && $request['model'] === 'qwen3:4b-instruct'
                && $request['stream'] === true
                && $request['options']['num_ctx'] === 2048
                && $request['options']['num_predict'] === 64
                && $request['options']['temperature'] === 0.7
                && $request['options']['top_p'] === 0.8
                && $request['options']['top_k'] === 20
                && ! $request->hasHeader('Authorization')
                && str_contains(mb_strtolower($systemMessage), 'staff can browse products and record sales')
                && ($messages[1]['content'] ?? '') === 'Is the catalog price controlled by the admin?'
                && ($messages[2]['content'] ?? '') === "How do I record a sale without changing its price?\n/no_think";
        });
    }

    public function test_assistant_requires_an_authenticated_workspace_user(): void
    {
        Http::fake();

        $this->postJson('/api/assistant', ['question' => 'What products are low stock?'])
            ->assertUnauthorized();

        Http::assertNothingSent();
    }
}
