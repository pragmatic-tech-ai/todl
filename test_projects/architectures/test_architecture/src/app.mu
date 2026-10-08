// src/app.mu — your application UI. Edit freely; it is never regenerated.
// The view-model class lives in ./main.ts; bind to its members with $Name.
import TodlTestArchApp from "./main.js"

Application
{
    resources:
    {
        ContentControl x:root [ Content = $service(TodlTestArchApp) ]

        DataTemplate [ DataType = TodlTestArchApp ]
        {
            StackPanel [ Orientation = Vertical, Margin = (16,16,16,16) ]
            {
                TextBlock [ Text = $HelloText ]
                TextBlock [ Text = $ConceptSummary ]
            }
        }
    }
}
