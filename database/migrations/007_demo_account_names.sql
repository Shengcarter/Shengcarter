-- Demo sign-in accounts take the names of the demo staff they belong to, so the
-- dashboard greets a person ("Good morning, Neema") instead of "Good morning, Demo".
-- Only demo accounts still carrying the original placeholder names are changed.
UPDATE users SET full_name = 'Zawadi Mollel'
 WHERE is_demo = 1 AND email = 'receptionist.demo@zolastylish.local' AND full_name = 'Demo Receptionist';
UPDATE users SET full_name = 'Neema Mwakyusa'
 WHERE is_demo = 1 AND email = 'stylist.demo@zolastylish.local' AND full_name = 'Demo Stylist (Neema)';
UPDATE users SET full_name = 'Baraka Mushi'
 WHERE is_demo = 1 AND email = 'accountant.demo@zolastylish.local' AND full_name = 'Demo Accountant';
