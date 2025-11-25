DELETE FROM payment WHERE staff_id > 2;
DELETE FROM rental WHERE staff_id > 2;

SELECT setval('rental_rental_id_seq', 16250, true); 
SELECT setval('payment_payment_id_seq', 32098, true); 

DELETE FROM staff WHERE staff_id > 2; 
SELECT setval('staff_staff_id_seq', 2, true); 