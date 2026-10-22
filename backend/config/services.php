<?php

return [

    'frontend_url' => explode(',', env('FRONTEND_URL', 'http://localhost:5173'))[0],

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    'ai' => [
        'provider' => env('AI_PROVIDER', 'ollama'),
    ],

    'ollama' => [
        'endpoint' => env('OLLAMA_ENDPOINT', 'http://127.0.0.1:11434/api/chat'),
        'model' => env('OLLAMA_MODEL', 'qwen3:4b-instruct'),
        'timeout' => (int) env('OLLAMA_TIMEOUT', 180),
        'keep_alive' => env('OLLAMA_KEEP_ALIVE', '30m'),
    ],

    'openai' => [
        'key' => env('OPENAI_API_KEY'),
        'model' => env('OPENAI_MODEL', 'gpt-6-astra'),
        'endpoint' => 'https://api.openai.com/v1/responses',
        'timeout' => (int) env('OPENAI_TIMEOUT', 35),
    ],

];
