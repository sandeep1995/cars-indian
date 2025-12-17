import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = await request.json();
    const { name, phone_number, email, car_name, location, is_sell } = body;

    if (!name || !phone_number) {
      return new Response(
        JSON.stringify({ error: 'Name and phone number are required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const db = locals.runtime?.env?.used_cars_db;
    if (!db) {
      return new Response(JSON.stringify({ error: 'Database not available' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const result = await db
      .prepare(
        'INSERT INTO contact_form (name, phone_number, email, car_name, location, is_sell) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(
        name,
        phone_number,
        email || null,
        car_name || null,
        location || null,
        is_sell ? 1 : 0
      )
      .run();

    return new Response(
      JSON.stringify({
        message: 'Resource created successfully',
        data: {
          name,
          phone_number,
          email: email || null,
          car_name: car_name || null,
          location: location || null,
          is_sell: is_sell ? true : false,
        },
      }),
      {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Error creating contact form entry:', error);
    return new Response(
      JSON.stringify({
        error: 'Failed to submit contact form',
        message: error.message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
};
